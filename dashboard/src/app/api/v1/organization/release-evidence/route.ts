import { z } from "zod";

import { catalystEvidenceTypes, releaseEvidenceHash } from "@/lib/catalyst-release";
import { boundedJson, handleApiError, ok, problem } from "@/lib/api";
import { db } from "@/lib/db";
import { authorizeReleaseEvidenceRequest } from "@/lib/release-evidence-auth";

const evidenceType = z.enum(catalystEvidenceTypes);
const schema = z.object({
  releaseSha: z.string().regex(/^[0-9a-f]{40}$/),
  evidenceType,
  network: z.string().trim().min(1).max(100).optional(),
  asset: z.string().trim().min(1).max(150).optional(),
  transactionId: z.string().trim().min(8).max(200).optional(),
  evidence: z.record(z.string(), z.unknown()),
});
const cardanoCanaries = new Set(["CARDANO_PREPROD_ADA_CANARY", "CARDANO_PREPROD_TOKEN_CANARY", "CARDANO_MAINNET_USDCX_CANARY"]);

function validateEvidence(input: z.infer<typeof schema>) {
  if (process.env.APP_ENV === "production" && process.env.RELEASE_SHA && input.releaseSha !== process.env.RELEASE_SHA) throw new Error("RELEASE_SHA_MISMATCH");
  if (cardanoCanaries.has(input.evidenceType)) {
    if (!input.transactionId || !/^[0-9a-f]{64}$/.test(input.transactionId)) throw new Error("CARDANO_CANARY_TRANSACTION_ID_REQUIRED");
    const expectedNetwork = input.evidenceType === "CARDANO_MAINNET_USDCX_CANARY" ? "cardano:mainnet" : "cardano:preprod";
    if (input.network !== expectedNetwork) throw new Error("CARDANO_CANARY_NETWORK_MISMATCH");
  }
  if (input.evidenceType === "DUNE_PUBLISHED") {
    const url = input.evidence.dashboardUrl;
    if (typeof url !== "string" || new URL(url).protocol !== "https:") throw new Error("DUNE_PUBLISHED_URL_REQUIRED");
  }
  if (input.evidenceType === "INDEPENDENT_SECURITY_ASSESSMENT") {
    const report = input.evidence.reportUrl;
    const assessor = input.evidence.assessor;
    if (typeof report !== "string" || new URL(report).protocol !== "https:" || typeof assessor !== "string" || assessor.trim().length < 2) throw new Error("SECURITY_ASSESSMENT_EVIDENCE_REQUIRED");
  }
}

export async function GET(request: Request) {
  try {
    if (!authorizeReleaseEvidenceRequest(request)) return problem(401, "UNAUTHORIZED", "A dedicated release-evidence credential is required.");
    const releaseSha = new URL(request.url).searchParams.get("releaseSha") ?? process.env.RELEASE_SHA ?? "";
    if (!/^[0-9a-f]{40}$/.test(releaseSha)) return problem(422, "RELEASE_SHA_REQUIRED", "Provide the exact 40-character release SHA.");
    const rows = await db.$queryRaw<Array<Record<string, unknown>>>`
      SELECT "releaseSha","evidenceType","network","asset","transactionId","evidenceHash","evidence","verifiedAt"
      FROM "ProductionReleaseEvidence" WHERE "releaseSha"=${releaseSha} ORDER BY "evidenceType" ASC
    `;
    return ok({ releaseSha, evidence: rows.map((row) => ({ ...row, network: row.network === "" ? null : row.network, asset: row.asset === "" ? null : row.asset })) });
  } catch (error) { return handleApiError(error); }
}

export async function POST(request: Request) {
  try {
    if (!authorizeReleaseEvidenceRequest(request)) return problem(401, "UNAUTHORIZED", "A dedicated release-evidence credential is required.");
    const input = schema.parse(await boundedJson(request, 128 * 1024));
    validateEvidence(input);
    const network = input.network ?? "";
    const asset = input.asset ?? "";
    const evidenceHash = releaseEvidenceHash({ releaseSha: input.releaseSha, evidenceType: input.evidenceType, network: network || null, asset: asset || null, transactionId: input.transactionId ?? null, evidence: input.evidence });
    await db.$executeRaw`
      INSERT INTO "ProductionReleaseEvidence" ("id","releaseSha","evidenceType","network","asset","transactionId","evidenceHash","evidence","verifiedBy","verifiedAt","createdAt")
      VALUES (gen_random_uuid(),${input.releaseSha},${input.evidenceType},${network},${asset},${input.transactionId ?? null},${evidenceHash},${JSON.stringify(input.evidence)}::jsonb,NULL,now(),now())
      ON CONFLICT ("releaseSha","evidenceType","network","asset") DO UPDATE SET "transactionId"=EXCLUDED."transactionId","evidenceHash"=EXCLUDED."evidenceHash","evidence"=EXCLUDED."evidence","verifiedBy"=NULL,"verifiedAt"=now()
    `;
    return ok({ releaseSha: input.releaseSha, evidenceType: input.evidenceType, evidenceHash });
  } catch (error) { return handleApiError(error); }
}
