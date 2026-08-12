import { createHash, timingSafeEqual } from "node:crypto";
import { z } from "zod";

import { handleApiError, ok, problem, requestBody } from "@/lib/api";
import { db } from "@/lib/db";

const bodySchema = z.object({
  action: z.enum(["CLAIM", "MARK_SUBMISSION_STARTED", "CONFIRM", "REJECT"]),
  transactionHash: z.string().regex(/^[0-9a-f]{64}$/),
  network: z.enum(["cardano:preprod", "cardano:mainnet"]),
  bindingHash: z.string().regex(/^[0-9a-f]{64}$/),
});

type ClaimRow = {
  transactionHash: string;
  network: string;
  bindingHash: string;
  state: "CLAIMED" | "SUBMISSION_STARTED" | "CONFIRMED" | "REJECTED";
  createdAt: Date;
  updatedAt: Date;
};

function authorized(request: Request) {
  const expected = process.env.CARDANO_SETTLEMENT_STORE_API_KEY;
  const authorization = request.headers.get("authorization");
  if (!expected || expected.length < 32 || !authorization?.startsWith("Bearer ")) return false;
  const actual = createHash("sha256").update(authorization.slice(7)).digest();
  const wanted = createHash("sha256").update(expected).digest();
  return timingSafeEqual(actual, wanted);
}

async function readClaim(transactionHash: string) {
  const rows = await db.$queryRaw<ClaimRow[]>`
    SELECT "transactionHash", "network", "bindingHash", "state", "createdAt", "updatedAt"
    FROM "CardanoSettlementClaim"
    WHERE "transactionHash" = ${transactionHash}
    LIMIT 1
  `;
  return rows[0] ?? null;
}

export async function POST(request: Request) {
  try {
    if (!authorized(request)) return problem(401, "UNAUTHORIZED", "A valid Cardano settlement-store credential is required.");
    const body = bodySchema.parse(await requestBody(request));

    const result = await db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`cardano-settlement:${body.transactionHash}`}, 0))`;

      const rows = await tx.$queryRaw<ClaimRow[]>`
        SELECT "transactionHash", "network", "bindingHash", "state", "createdAt", "updatedAt"
        FROM "CardanoSettlementClaim"
        WHERE "transactionHash" = ${body.transactionHash}
        LIMIT 1
      `;
      let claim = rows[0] ?? null;

      if (!claim) {
        if (body.action !== "CLAIM") throw new Error("CARDANO_SETTLEMENT_CLAIM_MISSING");
        await tx.$executeRaw`
          INSERT INTO "CardanoSettlementClaim" ("transactionHash", "network", "bindingHash", "state")
          VALUES (${body.transactionHash}, ${body.network}, ${body.bindingHash}, 'CLAIMED')
        `;
        claim = {
          transactionHash: body.transactionHash,
          network: body.network,
          bindingHash: body.bindingHash,
          state: "CLAIMED",
          createdAt: new Date(),
          updatedAt: new Date(),
        };
      }

      if (claim.network !== body.network || claim.bindingHash !== body.bindingHash) {
        return { replay: true as const, claim };
      }

      if (body.action === "MARK_SUBMISSION_STARTED" && claim.state === "CLAIMED") {
        await tx.$executeRaw`
          UPDATE "CardanoSettlementClaim"
          SET "state" = 'SUBMISSION_STARTED', "updatedAt" = CURRENT_TIMESTAMP
          WHERE "transactionHash" = ${body.transactionHash} AND "state" = 'CLAIMED'
        `;
      } else if (body.action === "CONFIRM" && claim.state !== "CONFIRMED") {
        await tx.$executeRaw`
          UPDATE "CardanoSettlementClaim"
          SET "state" = 'CONFIRMED', "updatedAt" = CURRENT_TIMESTAMP
          WHERE "transactionHash" = ${body.transactionHash}
        `;
      } else if (body.action === "REJECT" && claim.state !== "CONFIRMED") {
        await tx.$executeRaw`
          UPDATE "CardanoSettlementClaim"
          SET "state" = 'REJECTED', "updatedAt" = CURRENT_TIMESTAMP
          WHERE "transactionHash" = ${body.transactionHash}
        `;
      }

      const refreshed = await tx.$queryRaw<ClaimRow[]>`
        SELECT "transactionHash", "network", "bindingHash", "state", "createdAt", "updatedAt"
        FROM "CardanoSettlementClaim"
        WHERE "transactionHash" = ${body.transactionHash}
        LIMIT 1
      `;
      return { replay: false as const, claim: refreshed[0] ?? claim };
    }, { isolationLevel: "Serializable" });

    if (result.replay) return problem(409, "CARDANO_SETTLEMENT_REPLAY", "This Cardano transaction is already bound to a different payment.");
    return ok(result.claim);
  } catch (error) {
    if (error instanceof Error && error.message === "CARDANO_SETTLEMENT_CLAIM_MISSING") {
      return problem(409, error.message, "The Cardano transaction has not been durably claimed before this state transition.");
    }
    return handleApiError(error);
  }
}

export async function GET(request: Request) {
  try {
    if (!authorized(request)) return problem(401, "UNAUTHORIZED", "A valid Cardano settlement-store credential is required.");
    const url = new URL(request.url);
    const transactionHash = z.string().regex(/^[0-9a-f]{64}$/).parse(url.searchParams.get("transactionHash"));
    const claim = await readClaim(transactionHash);
    if (!claim) return problem(404, "CARDANO_SETTLEMENT_CLAIM_NOT_FOUND", "No durable settlement claim exists for this transaction.");
    return ok(claim);
  } catch (error) {
    return handleApiError(error);
  }
}
