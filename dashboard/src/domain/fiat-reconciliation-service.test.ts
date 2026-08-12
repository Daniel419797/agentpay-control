import { describe, expect, it } from "vitest";
import { fiatSubmissionFailureStatus, isRetryableFiatSubmission } from "@/domain/fiat-reconciliation-service";

describe("fiatSubmissionFailureStatus", () => {
  it.each([401, 403, 404])("treats definite pre-submission HTTP %s rejection as failed", (status) => {
    expect(fiatSubmissionFailureStatus(new Error(`FIAT_PROVIDER_ERROR:${status}:access_denied`))).toBe("FAILED");
  });

  it.each([400, 409, 422, 429, 500, 503])("keeps HTTP %s provider errors reconcilable", (status) => {
    expect(fiatSubmissionFailureStatus(new Error(`FIAT_PROVIDER_ERROR:${status}:idempotency_key_in_use`))).toBe("SUBMISSION_UNKNOWN");
  });

  it("keeps network and malformed failures reconcilable", () => {
    expect(fiatSubmissionFailureStatus(new Error("fetch failed"))).toBe("SUBMISSION_UNKNOWN");
    expect(fiatSubmissionFailureStatus("unknown")).toBe("SUBMISSION_UNKNOWN");
  });
});

describe("isRetryableFiatSubmission", () => {
  it("allows only locally pending or ambiguous placeholder submissions to retry", () => {
    expect(isRetryableFiatSubmission("PENDING", "pending_123")).toBe(true);
    expect(isRetryableFiatSubmission("SUBMISSION_UNKNOWN", "pending_123")).toBe(true);
    expect(isRetryableFiatSubmission("FAILED", "pending_123")).toBe(false);
    expect(isRetryableFiatSubmission("SUBMISSION_UNKNOWN", "ibt_external")).toBe(false);
  });
});
