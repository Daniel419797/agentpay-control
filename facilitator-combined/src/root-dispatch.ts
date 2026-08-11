export const ROOT_DISPATCH_BODY_LIMIT = 256 * 1024;

export type CombinedNetworkSet = { hedera: string; arc: string; cardano: string };
export type CombinedTarget = keyof CombinedNetworkSet;

export function paymentNetworkFromJson(text: string, byteLength = Buffer.byteLength(text, "utf8")) {
  if (byteLength > ROOT_DISPATCH_BODY_LIMIT) throw new Error("REQUEST_BODY_TOO_LARGE");
  let body: { paymentRequirements?: { network?: unknown }; paymentPayload?: { accepted?: { network?: unknown } } };
  try { body = JSON.parse(text); }
  catch { throw new Error("INVALID_JSON"); }
  const requirementNetwork = typeof body.paymentRequirements?.network === "string" ? body.paymentRequirements.network : undefined;
  const acceptedNetwork = typeof body.paymentPayload?.accepted?.network === "string" ? body.paymentPayload.accepted.network : undefined;
  if (!requirementNetwork || !acceptedNetwork || requirementNetwork !== acceptedNetwork) throw new Error("NETWORK_BINDING_REQUIRED");
  return requirementNetwork;
}

export function targetForNetwork(network: string, networks: CombinedNetworkSet): CombinedTarget | null {
  if (network === networks.hedera) return "hedera";
  if (network === networks.arc) return "arc";
  if (network === networks.cardano) return "cardano";
  return null;
}
