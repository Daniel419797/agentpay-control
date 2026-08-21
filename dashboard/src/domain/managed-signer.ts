import { z } from "zod";

import { getNetworkRouter } from "@/domain/network-router";

export const managedTestnetNetworks = ["hedera:testnet", "eip155:5042002", "cardano:preprod"] as const;
export type ManagedTestnetNetwork = (typeof managedTestnetNetworks)[number];

const managedIdentitySchema = z.object({
  accountId: z.string().min(3).max(200),
  publicKey: z.string().min(16).max(512).optional(),
  signerRef: z.string().min(8).max(200),
});

export type ManagedAgentIdentity = z.infer<typeof managedIdentitySchema>;

function assertManagedAccountId(network: ManagedTestnetNetwork, accountId: string) {
  if (network === "hedera:testnet" && !/^0\.0\.\d+$/.test(accountId)) throw new Error("MANAGED_IDENTITY_INVALID");
  if (network === "eip155:5042002" && !/^0x[0-9a-fA-F]{40}$/.test(accountId)) throw new Error("MANAGED_IDENTITY_INVALID");
  if (network === "cardano:preprod" && !/^addr_test1[0-9a-z]+$/.test(accountId)) throw new Error("MANAGED_IDENTITY_INVALID");
}

export function isManagedTestnetNetwork(network: string): network is ManagedTestnetNetwork {
  return (managedTestnetNetworks as readonly string[]).includes(network);
}

/**
 * Provision a public payment identity for one managed testnet agent.
 *
 * Private signing material never crosses this boundary. The rail-specific
 * signer/facilitator owns the key derivation/custody and returns only the
 * on-chain account/address plus an opaque signer reference.
 */
export async function provisionManagedAgentIdentity(network: ManagedTestnetNetwork, agentId: string): Promise<ManagedAgentIdentity> {
  const route = getNetworkRouter().getRoute(network);
  if (!route.facilitatorApiKey) throw new Error("MANAGED_SIGNER_CAPABILITY_REQUIRED");

  const response = await fetch(`${route.facilitatorUrl.replace(/\/$/, "")}/managed-identity`, {
    method: "POST",
    redirect: "error",
    cache: "no-store",
    signal: AbortSignal.timeout(30_000),
    headers: {
      "content-type": "application/json",
      accept: "application/json",
      authorization: `Bearer ${route.facilitatorApiKey}`,
    },
    body: JSON.stringify({ agentId, network }),
  });

  if (!response.ok) throw new Error(`MANAGED_IDENTITY_PROVISIONING_${response.status}`);
  const identity = managedIdentitySchema.parse(await response.json());
  assertManagedAccountId(network, identity.accountId);
  return network === "eip155:5042002" ? { ...identity, accountId: identity.accountId.toLowerCase() } : identity;
}
