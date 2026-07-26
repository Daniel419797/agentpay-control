import { db } from "../src/lib/db";
import { openUnresolvedSubmissionIncidents } from "../src/domain/maintenance-service";
import { getConfig } from "../src/lib/config";

async function main() {
  const databaseUrl = new URL(getConfig().DATABASE_URL);
  if (!["localhost", "127.0.0.1"].includes(databaseUrl.hostname)) {
    throw new Error("Governance verification is restricted to a disposable local database.");
  }

  const organization = await db.organization.create({
    data: {
      name: "Governance verification",
      slug: `governance-verification-${Date.now()}`,
    },
  });
  const agent = await db.agent.create({
    data: {
      organizationId: organization.id,
      name: "Governance verifier",
      status: "ACTIVE",
    },
    select: { id: true, organizationId: true },
  });
  const payment = await db.paymentIntent.create({
    data: {
      organizationId: agent.organizationId,
      agentId: agent.id,
      idempotencyKey: `governance-${Date.now()}`,
      requestHash: "0".repeat(64),
      resourceUrl: "https://governance-verifier.invalid/resource",
      merchantHost: "governance-verifier.invalid",
      status: "SUBMISSION_UNKNOWN",
    },
    select: { id: true, organizationId: true },
  });
  await db.$executeRaw`UPDATE "PaymentIntent" SET "updatedAt" = ${new Date("2026-01-01T00:00:00Z")} WHERE "id" = ${payment.id}::uuid`;

  const first = await openUnresolvedSubmissionIncidents(
    10,
    new Date("2026-07-26T16:00:00Z"),
  );
  const second = await openUnresolvedSubmissionIncidents(
    10,
    new Date("2026-07-26T16:01:00Z"),
  );
  const incident = await db.supportCase.findUniqueOrThrow({
    where: {
      organizationId_sourceType_sourceId: {
        organizationId: payment.organizationId,
        sourceType: "PAYMENT_INTENT",
        sourceId: payment.id,
      },
    },
  });
  const audit = await db.auditEvent.findFirstOrThrow({
    where: {
      organizationId: payment.organizationId,
      action: "RECONCILIATION_INCIDENT_OPENED",
      metadata: { path: ["sourceId"], equals: payment.id },
    },
  });

  if (first.opened !== 1 || second.opened !== 0) {
    throw new Error("Incident creation was not idempotent.");
  }
  if (incident.severity !== "URGENT" || incident.status !== "OPEN") {
    throw new Error("Incident did not receive the required operational priority.");
  }
  if (!audit.eventHash || audit.eventHash.length !== 64) {
    throw new Error("Incident audit evidence was not hash chained.");
  }

  console.log(JSON.stringify({
    first,
    second,
    incident: {
      sourceType: incident.sourceType,
      severity: incident.severity,
      status: incident.status,
    },
    auditHashChained: true,
  }));
}

main()
  .finally(() => db.$disconnect())
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
