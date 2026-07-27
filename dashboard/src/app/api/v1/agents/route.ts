import { z } from "zod";

import { handleApiError, ok, problem, requestBody } from "@/lib/api";
import { getConfig } from "@/lib/config";
import { db } from "@/lib/db";
import { workspaceFromRequest, workspaceHasRole } from "@/lib/workspace";
import { assertPlanLimit } from "@/domain/entitlement-service";

const createAgent = z.object({
  name: z.string().min(2).max(80),
  description: z.string().max(500).optional(),
  network: z.enum(["hedera:testnet", "hedera:mainnet", "eip155:5042002"]).default("hedera:testnet"),
  asset: z.enum(["HBAR", "USDC"]).default("HBAR"),
  custody: z.enum(["SELF_CUSTODY", "PLATFORM_MANAGED_TESTNET"]).default("SELF_CUSTODY"),
});

export async function GET(request: Request) {
  try {
    const workspace = await workspaceFromRequest(request);
    if (!workspace) return problem(401, "AUTH_REQUIRED", "Sign in before viewing agents.");
    const data = await db.agent.findMany({
      where: { organizationId: workspace.organization.id, status: { not: "ARCHIVED" } },
      orderBy: { createdAt: "desc" },
      include: {
        defaultAsset: true,
        accounts: { include: { balances: { orderBy: { asOf: "desc" }, take: 2, include: { asset: true } } } },
        effectivePolicy: true,
      },
    });
    return ok(data.map((agent) => ({
      ...agent,
      accounts: agent.accounts.map((account) => ({
        ...account,
        encryptedKeyBundle: undefined,
        balances: account.balances.map((balance) => ({
          ...balance,
          atomicAmount: balance.atomicAmount.toString(),
          spendableAtomic: balance.spendableAtomic.toString(),
        })),
      })),
    })));
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const workspace = await workspaceFromRequest(request);
    if (!workspace) return problem(401, "AUTH_REQUIRED", "Sign in before creating an agent.");
    if (!workspaceHasRole(workspace, ["OWNER", "OPERATOR"])) return problem(403, "ROLE_REQUIRED", "Owner or Operator access is required.");
    const input = createAgent.parse(await requestBody(request));
    const config = getConfig();
    const isArc = input.network === "eip155:5042002";
    const isHederaMainnet = input.network === "hedera:mainnet";
    if (isArc && input.custody !== "SELF_CUSTODY") {
      return problem(400, "CUSTODY_UNSUPPORTED", "Arc agents must use SELF_CUSTODY. Platform-managed is not yet supported for Arc.");
    }
    if (isHederaMainnet && input.custody !== "SELF_CUSTODY") {
      return problem(400, "CUSTODY_UNSUPPORTED", "Hedera Mainnet agents must use SELF_CUSTODY. Platform-managed is only available for testnet.");
    }

    const [asset, wallet] = await Promise.all([
      db.asset.findUnique({ where: { network_symbol: { network: input.network, symbol: input.asset } } }),
      input.custody === "SELF_CUSTODY"
        ? db.walletIdentity.findFirst({ where: { userId: workspace.user.id, network: input.network }, orderBy: { verifiedAt: "desc" } })
        : null,
    ]);
    if (!asset) return problem(409, "ASSET_NOT_CONFIGURED", `${input.asset} is not configured for ${input.network}.`);
    if (input.custody === "SELF_CUSTODY" && !wallet) return problem(409, "WALLET_REQUIRED", `Connect and verify a wallet for ${input.network} before creating a self-custody agent.`);
    const managedSignerAvailable = isHederaMainnet
      ? config.HEDERA_MAINNET_FACILITATOR_URL
      : config.HEDERA_PAYER_ACCOUNT_ID && config.FACILITATOR_URL;
    if (input.custody === "PLATFORM_MANAGED_TESTNET" && !managedSignerAvailable) {
      return problem(503, "MANAGED_SIGNER_UNAVAILABLE", "The managed testnet signer is not configured.");
    }
    const accountId = input.custody === "SELF_CUSTODY" ? wallet!.accountId : config.HEDERA_PAYER_ACCOUNT_ID!;
    const network = input.custody === "SELF_CUSTODY" ? wallet!.network : input.network;
    if (input.custody === "SELF_CUSTODY") {
      const inUse = await db.paymentAccount.findFirst({ where: { network, accountId } });
      if (inUse) return problem(409, "WALLET_ALREADY_ASSIGNED", "This wallet already backs another agent.");
    }
    let evmAddress: string | undefined;
    let publicKey: string | undefined;
    let initialBalanceAtomic = "0";

    if (isArc) {
      evmAddress = accountId.toLowerCase();
      try {
        const rpcUrl = config.ARC_RPC_URL ?? "https://rpc.testnet.arc.network";
        const rpcResponse = await fetch(rpcUrl, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getBalance", params: [accountId, "latest"] }),
          signal: AbortSignal.timeout(10_000),
        });
        if (rpcResponse.ok) {
          const result = await rpcResponse.json() as { result?: string };
          initialBalanceAtomic = result.result ? String(BigInt(result.result)) : "0";
        }
      } catch { /* balance unavailable, continue with 0 */ }
    } else {
      const mirrorUrl = isHederaMainnet
        ? config.HEDERA_MAINNET_MIRROR_NODE_URL
        : config.HEDERA_MIRROR_NODE_URL;
      const mirrorResponse = await fetch(`${mirrorUrl}/api/v1/accounts/${accountId}`, { cache: "no-store", signal: AbortSignal.timeout(10_000) });
      if (!mirrorResponse.ok) return problem(502, "MIRROR_NODE_UNAVAILABLE", "The wallet balance could not be read from Hedera.");
      const mirror = await mirrorResponse.json() as { balance?: { balance?: number }; evm_address?: string; key?: { key?: string } };
      initialBalanceAtomic = String(mirror.balance?.balance ?? 0);
      evmAddress = mirror.evm_address;
      publicKey = mirror.key?.key;
    }

    const agent = await db.$transaction(async (tx) => {
      await assertPlanLimit(tx, workspace.organization.id, "AGENTS");
      const created = await tx.agent.create({
        data: {
          organizationId: workspace.organization.id,
          name: input.name,
          description: input.description || null,
          status: "ACTIVE",
          defaultAssetId: asset.id,
          accounts: {
            create: {
              network,
              accountId,
              evmAddress,
              publicKey,
              custodyType: input.custody,
              signingMode: input.custody === "SELF_CUSTODY" ? "WALLET_CONFIRMATION" : "AUTONOMOUS_MANAGED",
              status: "ACTIVE",
              syncedAt: new Date(),
              balances: {
                create: {
                  assetId: asset.id,
                  atomicAmount: initialBalanceAtomic,
                  spendableAtomic: initialBalanceAtomic,
                  source: isArc ? "ARC_RPC" : "HEDERA_MIRROR_NODE",
                  asOf: new Date(),
                },
              },
            },
          },
        },
      });
      await tx.auditEvent.create({
        data: {
          organizationId: workspace.organization.id,
          actorType: "USER",
          actorId: workspace.user.id,
          action: "AGENT_CREATED",
          targetType: "AGENT",
          targetId: created.id,
          result: "SUCCESS",
          metadata: { accountId, custodyType: input.custody },
        },
      });
      return created;
    });
    if (!(request.headers.get("content-type") ?? "").includes("application/json")) {
      return Response.redirect(new URL(`/app/agents/${agent.id}`, request.url), 303);
    }
    return ok(agent, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message === "PLAN_AGENTS_LIMIT_REACHED") return problem(402, error.message, "Your plan's active-agent limit has been reached.");
    return handleApiError(error);
  }
}
