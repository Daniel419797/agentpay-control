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

async function arcUsdcBalance(accountId: string) {
  const config = getConfig();
  if (!config.ARC_RPC_URL) throw new Error("ARC_RPC_UNAVAILABLE");
  const data = `0x70a08231${accountId.slice(2).toLowerCase().padStart(64, "0")}`;
  const response = await fetch(config.ARC_RPC_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_call", params: [{ to: config.ARC_USDC_ADDRESS, data }, "latest"] }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error("ARC_BALANCE_UNAVAILABLE");
  const payload = z.object({ result: z.string().regex(/^0x[0-9a-fA-F]+$/) }).safeParse(await response.json());
  if (!payload.success) throw new Error("ARC_BALANCE_UNAVAILABLE");
  return BigInt(payload.data.result).toString();
}

function hederaAssetBalance(
  asset: { type: string; hederaTokenId: string | null },
  balance: { balance?: number; tokens?: Array<{ token_id?: string; balance?: number }> } | undefined,
) {
  if (asset.type === "NATIVE") return String(balance?.balance ?? 0);
  if (!asset.hederaTokenId) throw new Error("HEDERA_TOKEN_ID_REQUIRED");
  const token = balance?.tokens?.find((candidate) => candidate.token_id === asset.hederaTokenId);
  return String(token?.balance ?? 0);
}

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
    if (isArc && input.asset !== "USDC") return problem(400, "ASSET_UNSUPPORTED", "Arc testnet agents use the configured USDC rail.");
    if (isArc && input.custody !== "PLATFORM_MANAGED_TESTNET") {
      return problem(400, "CUSTODY_UNSUPPORTED", "Arc browser-wallet custody is not enabled. Use the isolated managed Arc signer.");
    }
    if (isHederaMainnet && input.custody !== "SELF_CUSTODY") {
      return problem(400, "CUSTODY_UNSUPPORTED", "Hedera Mainnet agents must use SELF_CUSTODY. Platform-managed custody is intentionally testnet-only.");
    }

    const [asset, wallet] = await Promise.all([
      db.asset.findUnique({ where: { network_symbol: { network: input.network, symbol: input.asset } } }),
      input.custody === "SELF_CUSTODY"
        ? db.walletIdentity.findFirst({ where: { userId: workspace.user.id, network: input.network }, orderBy: { verifiedAt: "desc" } })
        : null,
    ]);
    if (!asset) return problem(409, "ASSET_NOT_CONFIGURED", `${input.asset} is not configured for ${input.network}.`);
    if (input.custody === "SELF_CUSTODY" && !wallet) return problem(409, "WALLET_REQUIRED", `Connect and verify a wallet for ${input.network} before creating a self-custody agent.`);

    const managedSignerAvailable = isArc
      ? Boolean(config.ARC_FACILITATOR_URL && config.ARC_FACILITATOR_SIGNING_API_KEY && config.ARC_PAYER_ADDRESS)
      : Boolean(config.HEDERA_PAYER_ACCOUNT_ID && config.FACILITATOR_URL && config.FACILITATOR_SIGNING_API_KEY);
    if (input.custody === "PLATFORM_MANAGED_TESTNET" && !managedSignerAvailable) {
      return problem(503, "MANAGED_SIGNER_UNAVAILABLE", `The managed ${isArc ? "Arc" : "Hedera"} testnet signer is not fully configured.`);
    }

    const accountId = input.custody === "SELF_CUSTODY"
      ? wallet!.accountId
      : isArc
        ? config.ARC_PAYER_ADDRESS!
        : config.HEDERA_PAYER_ACCOUNT_ID!;
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
      initialBalanceAtomic = await arcUsdcBalance(evmAddress);
    } else {
      const mirrorUrl = isHederaMainnet ? config.HEDERA_MAINNET_MIRROR_NODE_URL : config.HEDERA_MIRROR_NODE_URL;
      const mirrorResponse = await fetch(`${mirrorUrl}/api/v1/accounts/${accountId}`, { cache: "no-store", signal: AbortSignal.timeout(10_000) });
      if (!mirrorResponse.ok) return problem(502, "MIRROR_NODE_UNAVAILABLE", "The wallet balance could not be read from Hedera.");
      const mirror = await mirrorResponse.json() as { balance?: { balance?: number; tokens?: Array<{ token_id?: string; balance?: number }> }; evm_address?: string; key?: { key?: string } };
      initialBalanceAtomic = hederaAssetBalance(asset, mirror.balance);
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
          network,
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
                  source: isArc ? "ARC_USDC_RPC" : "HEDERA_MIRROR_NODE",
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
          metadata: { accountId, network, custodyType: input.custody, asset: asset.symbol },
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
    if (error instanceof Error && ["ARC_RPC_UNAVAILABLE", "ARC_BALANCE_UNAVAILABLE"].includes(error.message)) return problem(502, error.message, "The Arc USDC balance could not be verified before agent activation.");
    if (error instanceof Error && error.message === "HEDERA_TOKEN_ID_REQUIRED") return problem(409, error.message, "The selected Hedera token is missing a verified token ID.");
    return handleApiError(error);
  }
}
