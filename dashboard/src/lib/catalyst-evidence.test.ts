import { describe, expect, it } from "vitest";

import { parseCatalystEvidenceShape } from "@/lib/catalyst-evidence";

const operationalEvidence = [
  "REMOTE_SIGNER_CUSTODY_REVIEW",
  "MONITORING_ONCALL",
  "PITR_RESTORE_DRILL",
  "INCIDENT_EXERCISE",
  "INDEPENDENT_SECURITY_ASSESSMENT",
] as const;

describe("Catalyst release evidence", () => {
  it.each(operationalEvidence)("rejects empty %s evidence", (evidenceType) => {
    expect(() => parseCatalystEvidenceShape(evidenceType, {})).toThrow();
  });

  it("requires independently checkable Cardano payment facts", () => {
    expect(() => parseCatalystEvidenceShape("CARDANO_PREPROD_ADA_CANARY", {
      source: "operator-executed-canary",
      transactionId: "a".repeat(64),
      recordedAt: new Date().toISOString(),
    })).toThrow();
  });

  it("caps Dune chain samples so release attestation cannot trigger unbounded verification", () => {
    expect(() => parseCatalystEvidenceShape("DUNE_SAMPLE_VERIFIED", {
      dashboardUrl: "https://dune.com/example/agentpay",
      executedAt: new Date().toISOString(),
      blockfrostVerifiedTransactionIds: Array.from({ length: 4 }, (_, index) => String(index + 1).repeat(64).slice(0, 64)),
    })).toThrow();
  });

  it("accepts concrete monitoring evidence", () => {
    expect(parseCatalystEvidenceShape("MONITORING_ONCALL", {
      runbookUrl: "https://example.com/runbooks/agentpay",
      onCallOwner: "payments-primary",
      pagingProvider: "PagerDuty",
      pagingTestAt: new Date().toISOString(),
      outcome: "passed",
    })).toMatchObject({ outcome: "passed" });
  });

  it("requires zero open critical and high findings for release assessment evidence", () => {
    expect(() => parseCatalystEvidenceShape("INDEPENDENT_SECURITY_ASSESSMENT", {
      reportUrl: "https://example.com/reports/security.pdf",
      assessor: "Independent Security Lab",
      completedAt: new Date().toISOString(),
      outcome: "accepted_with_findings",
      openCriticalFindings: 0,
      openHighFindings: 1,
    })).toThrow();
  });
});
