import { GET as streamExport } from "@/app/api/v1/organization/export-stream/route";

export async function GET(request: Request) {
  const response = await streamExport(request);
  if (!response.ok || !response.body) return response;

  const reader = response.body.getReader();
  const encoder = new TextEncoder();
  let closed = false;
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const next = await reader.read();
        if (!next.done) {
          controller.enqueue(next.value);
          return;
        }
        if (!closed) controller.enqueue(encoder.encode("]}"));
        closed = true;
        controller.close();
      } catch (error) {
        controller.error(error);
      }
    },
    async cancel(reason) {
      await reader.cancel(reason);
    },
  });

  return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
}
