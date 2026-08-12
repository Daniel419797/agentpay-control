import { describe, expect, it } from "vitest";
import { catalystProductionConfigErrors, releaseEvidenceHash } from "@/lib/catalyst-release";

const base = {
  APP_ENV: "production",
  CATALYST_PRODUCTION_ENABLED: "true",
  CARDANO_USDCX_ENABLED: "true",
  PYTH_POLICY_ENABLED: "true",
  MASUMI_POLICY_ENABLED: "true",
  MASUMI_ESCROW_ENABLED: "true",
  VERIDIAN_IDENTITY_ENABLED: "true",
  DUNE_ANALYTICS_ENABLED: "true",
};

describe("Catalyst release contract", () => {
  it("requires an exact release SHA and dedicated evidence credential", () => {
    const errors = catalystProductionConfigErrors(base);
    expect(errors).toContain("RELEASE_SHA");
    expect(errors).toContain("RELEASE_EVIDENCE_API_KEY");
  });

  it("hashes release evidence deterministically including dates", () => {
    const left = releaseEvidenceHash({ b: 2, a: 1, at: new Date("2026-08-11T00:00:00.000Z") });
    const right = releaseEvidenceHash({ at: new Date("2026-08-11T00:00:00.000Z"), a: 1, b: 2 });
    expect(left).toBe(right);
    expect(left).toMatch(/^[0-9a-f]{64}$/);
  });
});
