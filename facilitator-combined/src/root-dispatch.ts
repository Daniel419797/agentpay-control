export const ROOT_DISPATCH_BODY_LIMIT = 256 * 1024;

export type CombinedTarget = "hederaTestnet" | "hederaMainnet" | "arcTestnet" | "cardanoPreprod" | "cardanoMainnet";
export type CombinedNetworkMap = Readonly<Record<string, CombinedTarget>>;

export async function boundedRequestText(request: Request, maxBytes = ROOT_DISPATCH_BODY_LIMIT) {
  const contentLength = request.headers.get("content-length");
  if (contentLength !== null) {
    const declared = Number(contentLength);
    if (!Number.isSafeInteger(declared) || declared < 0) throw new Error("INVALID_CONTENT_LENGTH");
    if (declared > maxBytes) throw new Error("REQUEST_BODY_TOO_LARGE");
  }
  if (!request.body) return "";

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel("REQUEST_BODY_TOO_LARGE").catch(() => undefined);
        throw new Error("REQUEST_BODY_TOO_LARGE");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error("INVALID_UTF8");
  }
}

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

export function targetForNetwork(network: string, networks: CombinedNetworkMap): CombinedTarget | null {
  return networks[network] ?? null;
}
