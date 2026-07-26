export type ExactRequirement = {
  scheme: "exact";
  network: string;
  amount: string;
  payTo: string;
  asset: string;
};

export function sameRequirement(left: ExactRequirement, right: ExactRequirement) {
  return left.scheme === right.scheme
    && left.network === right.network
    && left.amount === right.amount
    && left.payTo === right.payTo
    && left.asset === right.asset;
}

export async function boundedJson(request: Request, maxBytes = 64 * 1024): Promise<unknown> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > maxBytes) throw new Error("REQUEST_BODY_TOO_LARGE");
  if (!request.body) return {};
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      throw new Error("REQUEST_BODY_TOO_LARGE");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder().decode(bytes));
}
