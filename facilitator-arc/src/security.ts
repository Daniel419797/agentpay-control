import { timingSafeEqual } from "node:crypto";

export type PublicFailure = {
  code: "REQUEST_BODY_TOO_LARGE" | string;
  status: 400 | 413 | 422 | 500;
};

export function publicFailure(error: unknown, fallbackCode: string, fallbackStatus: 400 | 422 | 500): PublicFailure {
  if (error instanceof Error && error.message === "REQUEST_BODY_TOO_LARGE") {
    return { code: "REQUEST_BODY_TOO_LARGE", status: 413 };
  }
  return { code: fallbackCode, status: fallbackStatus };
}

export function logFailure(event: string, error: unknown) {
  console.error(JSON.stringify({
    event,
    errorType: error instanceof Error ? error.name : "UnknownError",
  }));
}

export async function boundedJson(request: Request, maxBytes = 64 * 1024): Promise<unknown> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > maxBytes) throw new Error("REQUEST_BODY_TOO_LARGE");
  if (!request.body) return {};
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error("REQUEST_BODY_TOO_LARGE");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder().decode(bytes));
}

export type ContractAllowlistEntry = {
  contractAddress: string;
  selectors: string[];
  maxGas: number;
  maxPayableAtomic: string;
};

export type ContractCall = {
  contractAddress: string;
  functionSelector: string;
  calldata: string;
  gas: number;
  payableAtomic: string;
};

export function authorizationMatches(apiKey: string | undefined, authorization: string | undefined) {
  if (!apiKey) return true;
  if (!authorization?.startsWith("Bearer ")) return false;

  const expected = Buffer.from(apiKey, "utf8");
  const actual = Buffer.from(authorization.slice(7), "utf8");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function capabilityAuthorizationMatches(
  capabilityKey: string | undefined,
  legacyKey: string | undefined,
  authorization: string | undefined,
) {
  return authorizationMatches(capabilityKey ?? legacyKey, authorization);
}

export function validateContractCall(
  call: ContractCall,
  allowlist: ContractAllowlistEntry[]
): "SELECTOR_CALLDATA_MISMATCH" | "CONTRACT_CALL_NOT_ALLOWLISTED" | "CONTRACT_CALL_LIMIT_EXCEEDED" | null {
  const selector = call.functionSelector.toLowerCase();
  if (!call.calldata.toLowerCase().startsWith(selector)) {
    return "SELECTOR_CALLDATA_MISMATCH";
  }

  const allowed = allowlist.find(
    (entry) =>
      entry.contractAddress.toLowerCase() === call.contractAddress.toLowerCase() &&
      entry.selectors.some((candidate) => candidate.toLowerCase() === selector)
  );
  if (!allowed) return "CONTRACT_CALL_NOT_ALLOWLISTED";

  if (
    call.gas > allowed.maxGas ||
    BigInt(call.payableAtomic) > BigInt(allowed.maxPayableAtomic)
  ) {
    return "CONTRACT_CALL_LIMIT_EXCEEDED";
  }

  return null;
}
