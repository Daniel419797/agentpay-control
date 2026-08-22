import { randomUUID } from "node:crypto";
import { z } from "zod";

import { handleApiError, ok, problem, requestBody } from "@/lib/api";
import { getConfig } from "@/lib/config";
import { db } from "@/lib/db";
import { hasRecentAuthentication } from "@/lib/session";
import { cardanoAddressAssetBalance, type CardanoNetwork } from "@/lib/cardano";
import { cardanoAssetIdentifier } from "@/lib/cardano-assets";
import { workspaceFromRequest, workspaceHasRole } from "@/lib/workspace";
import { assertPlanLimit } from "@/domain/entitlement-service";
import { getNetworkRouter } from "@/domain/network-router";
import { isManagedTestnetNetwork, provisionManagedAgentIdentity } from "@/domain/managed-signer";

const createAgent = z.object({
  name: z.string().min(2).max(80),
  description: z.string().max(500).optional(),
  network: z.enum(["hedera:testnet", "hedera:mainnet", "eip155:5042002", "cardano:preprod", "cardano:mainnet"]).default("hedera:testnet"),
  asset: z.enum(["HBAR", "USDC", "ADA", "USDCX"]).default("HBAR"),
  custody: z.enum(["SELF_CUSTODY", "PLATFORM_MANAGED_TESTNET", "EXTERNAL_DELEGATED"]).default("SELF_CUSTODY"),
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
    if (!hasRecentAuthentication(workspace.session)) return problem(401, "RECENT_AUTH_REQUIRED", "Re-authenticate before provisioning a payment signer.");
    if (workspace.organization.killSwitchEnabled) return problem(423, "ORGANIZATION_KILL_SWITCH_ENABLED", "Disable the emergency stop before provisioning a payment signer.");

    const input = createAgent.parse(await requestBody(request));
    const config = getConfig();
    const isArc = input.network === "eip155:5042002";
    const isHederaMainnet = input.network === "hedera:mainnet";
    const isCardanoPreprod = input.network === "cardano:preprod";
    const isCardanoMainnet = input.network === "cardano:mainnet";
    const isCardano = isCardanoPreprod || isCardanoMainnet;
    const isManagedTestnet = input.custody === "PLATFORM_MANAGED_TESTNET";
    const isExternalDelegated = input.custody === "EXTERNAL_DELEGATED";
    const usesManagedSigner = isManagedTestnet || isExternalDelegated;

    if (isArc && input.asset !== "USDC") return problem(400, "ASSET_UNSUPPORTED", "Arc testnet agents use the configured USDC rail.");
    if (isArc && !["SELF_CUSTODY", "PLATFORM_MANAGED_TESTNET"].includes(input.custody)) return problem(400, "CUSTODY_UNSUPPORTED", "Arc supports verified self-custody wallets or an isolated managed testnet wallet.");
    if (isHederaMainnet && input.custody !== "SELF_CUSTODY") return problem(400, "CUSTODY_UNSUPPORTED", "Hedera Mainnet agents must use SELF_CUSTODY. Platform-managed custody is intentionally testnet-only.");
    if (isCardano && !["ADA", "USDCX"].includes(input.asset)) return problem(400, "ASSET_UNSUPPORTED", "Cardano autonomous agents support ADA or the explicitly configured USDCx asset only.");
    if (isCardanoPreprod && !["SELF_CUSTODY", "PLATFORM_MANAGED_TESTNET"].includes(input.custody)) return problem(400, "CUSTODY_UNSUPPORTED", "Cardano Preprod supports verified self-custody wallets or an isolated managed testnet wallet.");
    if (isCardanoMainnet && !["SELF_CUSTODY", "EXTERNAL_DELEGATED"].includes(input.custody)) return problem(400, "CUSTODY_UNSUPPORTED", "Cardano Mainnet supports verified self-custody wallets or isolated external per-agent custody.");
    if (isManagedTestnet && !isManagedTestnetNetwork(input.network)) return problem(400, "MANAGED_SIGNER_TESTNET_ONLY", "Deterministic managed wallets are isolated per agent and available only on supported test networks.");
    if (isExternalDelegated && !isCardanoMainnet) return problem(400, "CUSTODY_UNSUPPORTED", "External delegated managed custody is currently supported for Cardano Mainnet only.");

    if (!getNetworkRouter().supportsNetwork(input.network)) return problem(503, "PAYMENT_RAIL_UNAVAILABLE", `${input.network} is not fully configured for this deployment.`);

    const [asset, wallet] = await Promise.all([
      db.asset.findUnique({ where: { network_symbol: { network: input.network, symbol: input.asset } } }),
      input.custody === "SELF_CUSTODY"
        ? db.walletIdentity.findFirst({ where: { userId: workspace.user.id, network: input.network }, orderBy: { verifiedAt: "desc" } })
        : null,
    ]);
    if (!asset) return problem(409, "ASSET_NOT_CONFIGURED", `${input.asset} is not configured for ${input.network}.`);
    if (input.custody === "SELF_CUSTODY" && !wallet) return problem(409, "WALLET_REQUIRED", `Connect and verify a wallet for ${input.network} before creating a self-custody agent.`);

    const cardanoAsset = isCardano ? cardanoAssetIdentifier(asset, input.network) : null;
    const agentId = randomUUID();

    await db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`agent-provision:${workspace.organization.id}`}, 0))`;
      const organization = await tx.organization.findUniqueOrThrow({ where: { id: workspace.organization.id }, select: { status: true, killSwitchEnabled: true } });
      if (organization.status !== "ACTIVE" || organization.killSwitchEnabled) throw new Error("ORGANIZATION_STOPPED");
      await assertPlanLimit(tx, workspace.organization.id, "AGENTS");
    });

    const managedIdentity = usesManagedSigner
      ? await provisionManagedAgentIdentity(input.network, agentId)
      : null;
    const accountId = input.custody === "SELF_CUSTODY" ? wallet!.accountId : managedIdentity!.accountId;
    const network = input.network;

    const inUse = await db.paymentAccount.findFirst({ where: { network, accountId, status: { not: "ERROR" } }, select: { id: true, agentId: true } });
    if (inUse) return problem(409, usesManagedSigner ? "MANAGED_IDENTITY_NOT_ISOLATED" : "WALLET_ALREADY_ASSIGNED", usesManagedSigner ? "The managed signer returned an account already assigned to another agent. Provisioning was stopped." : "This wallet already backs another agent.");

    let evmAddress: string | undefined;
    let publicKey: string | undefined = managedIdentity?.publicKey;
    let initialBalanceAtomic = "0";
    let balanceSource = isExternalDelegated ? "EXTERNAL_MANAGED_IDENTITY_INITIAL" : isManagedTestnet ? "ISOLATED_MANAGED_IDENTITY_INITIAL" : "HEDERA_MIRROR_NODE";

    if (usesManagedSigner) {
      if (isArc) evmAddress = accountId.toLowerCase();
      initialBalanceAtomic = "0";
    } else if (isArc) {
      evmAddress = accountId.toLowerCase();
      initialBalanceAtomic = await arcUsdcBalance(evmAddress);
      balanceSource = "ARC_USDC_RPC";
    } else if (isCardano) {
      initialBalanceAtomic = await cardanoAddressAssetBalance(network as CardanoNetwork, accountId, cardanoAsset!);
      balanceSource = cardanoAsset === "lovelace" ? "CARDANO_BLOCKFROST_ADA" : "CARDANO_BLOCKFROST_NATIVE_ASSET";
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
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`agent-provision:${workspace.organization.id}`}, 0))`;
      const organization = await tx.organization.findUniqueOrThrow({ where: { id: workspace.organization.id }, select: { status: true, killSwitchEnabled: true } });
      if (organization.status !== "ACTIVE" || organization.killSwitchEnabled) throw new Error("ORGANIZATION_STOPPED");
      await assertPlanLimit(tx, workspace.organization.id, "AGENTS");
      const duplicate = await tx.paymentAccount.findFirst({ where: { network, accountId, status: { not: "ERROR" } }, select: { id: true } });
      if (duplicate) throw new Error("MANAGED_IDENTITY_NOT_ISOLATED");

      const created = await tx.agent.create({
        data: {
          id: agentId,
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
                  source: balanceSource,
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
          metadata: { accountId, network, custodyType: input.custody, asset: asset.symbol, cardanoAsset: cardanoAsset ?? null, signerRef: managedIdentity?.signerRef ?? null, identityIsolation: usesManagedSigner ? "PER_AGENT" : "SELF_CUSTODY" },
        },
      });
      return created;
    });
    if (!(request.headers.get("content-type") ?? "").includes("application/json")) return Response.redirect(new URL(`/app/agents/${agent.id}`, request.url), 303);
    return ok(agent, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message === "PLAN_AGENTS_LIMIT_REACHED") return problem(402, error.message, "Your plan's active-agent limit has been reached.");
    if (error instanceof Error && error.message === "ORGANIZATION_STOPPED") return problem(423, error.message, "Agent provisioning was stopped because the organization is inactive or the emergency stop became active.");
    if (error instanceof Error && error.message === "MANAGED_IDENTITY_NOT_ISOLATED") return problem(409, error.message, "The signer attempted to reuse an existing managed payment identity. Agent creation was blocked.");
    if (error instanceof Error && (error.message.startsWith("MANAGED_IDENTITY_") || error.message.startsWith("MANAGED_SIGNER_"))) return problem(502, error.message, "An isolated managed payment identity could not be provisioned.");
    if (error instanceof Error && ["ARC_RPC_UNAVAILABLE", "ARC_BALANCE_UNAVAILABLE"].includes(error.message)) return problem(502, error.message, "The Arc USDC balance could not be verified before agent activation.");
    if (error instanceof Error && ["CARDANO_PREPROD_USDCX_ASSET_ID_REQUIRED", "CARDANO_MAINNET_USDCX_ASSET_ID_REQUIRED", "CARDANO_ASSET_UNSUPPORTED"].includes(error.message)) return problem(409, error.message, "The selected Cardano asset is not fully configured for this deployment.");
    if (error instanceof Error && error.message.startsWith("CARDANO_")) return problem(502, error.message, "The Cardano signer, custody adapter, balance or chain evidence could not be verified before agent activation.");
    if (error instanceof Error && error.message === "HEDERA_TOKEN_ID_REQUIRED") return problem(409, error.message, "The selected Hedera token is missing a verified token ID.");
    return handleApiError(error);
  }
}
