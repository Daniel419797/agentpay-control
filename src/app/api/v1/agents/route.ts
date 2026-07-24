import { z } from "zod";

import { handleApiError, ok, problem, requestBody } from "@/lib/api";
import { getConfig } from "@/lib/config";
import { db } from "@/lib/db";
import { workspaceFromRequest } from "@/lib/workspace";

const createAgent = z.object({
  name: z.string().min(2).max(80),
  description: z.string().max(500).optional(),
  asset: z.enum(["HBAR", "USDC"]).default("HBAR"),
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
    const input = createAgent.parse(await requestBody(request));
    const [asset, wallet] = await Promise.all([
      db.asset.findUnique({ where: { network_symbol: { network: "hedera:testnet", symbol: input.asset } } }),
      db.walletIdentity.findFirst({ where: { userId: workspace.user.id, network: "hedera:testnet" }, orderBy: { verifiedAt: "desc" } }),
    ]);
    if (!asset) return problem(409, "ASSET_NOT_CONFIGURED", `${input.asset} is not configured for Hedera testnet.`);
    if (!wallet) return problem(409, "WALLET_REQUIRED", "Connect and verify HashPack before creating an agent.");
    const inUse = await db.paymentAccount.findUnique({ where: { network_accountId: { network: wallet.network, accountId: wallet.accountId } } });
    if (inUse) return problem(409, "WALLET_ALREADY_ASSIGNED", "This wallet already backs another agent.");

    const mirrorResponse = await fetch(`${getConfig().HEDERA_MIRROR_NODE_URL}/api/v1/accounts/${wallet.accountId}`, { cache: "no-store" });
    if (!mirrorResponse.ok) return problem(502, "MIRROR_NODE_UNAVAILABLE", "The wallet balance could not be read from Hedera.");
    const mirror = await mirrorResponse.json() as { balance?: { balance?: number }; evm_address?: string; key?: { key?: string } };
    const tinybar = String(mirror.balance?.balance ?? 0);
    const agent = await db.$transaction(async (tx) => {
      const created = await tx.agent.create({
        data: {
          organizationId: workspace.organization.id,
          name: input.name,
          description: input.description || null,
          status: "ACTIVE",
          defaultAssetId: asset.id,
          accounts: {
            create: {
              network: wallet.network,
              accountId: wallet.accountId,
              evmAddress: mirror.evm_address,
              publicKey: mirror.key?.key,
              custodyType: "SELF_CUSTODY",
              signingMode: "WALLET_CONFIRMATION",
              status: "ACTIVE",
              syncedAt: new Date(),
              balances: input.asset === "HBAR" ? {
                create: {
                  assetId: asset.id,
                  atomicAmount: tinybar,
                  spendableAtomic: tinybar,
                  source: "HEDERA_MIRROR_NODE",
                  asOf: new Date(),
                },
              } : undefined,
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
          metadata: { accountId: wallet.accountId, custodyType: "SELF_CUSTODY" },
        },
      });
      return created;
    });
    if (!(request.headers.get("content-type") ?? "").includes("application/json")) {
      return Response.redirect(new URL(`/app/agents/${agent.id}`, request.url), 303);
    }
    return ok(agent, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
