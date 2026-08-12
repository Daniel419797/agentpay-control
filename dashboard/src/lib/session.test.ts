import { describe, expect, it } from "vitest";

import { hasRecentAuthentication, STEP_UP_MAX_AGE_SECONDS } from "@/lib/session";

const session = {
  sub: "00000000-0000-0000-0000-000000000001",
  email: "owner@example.test",
  name: "Owner",
  mode: "supabase" as const,
  authenticatedAt: 1_000,
  sessionVersion: 0,
};

describe("step-up authentication", () => {
  it("accepts a recently authenticated operator", () => {
    expect(hasRecentAuthentication(session, 1_000 + STEP_UP_MAX_AGE_SECONDS)).toBe(true);
  });

  it("rejects stale and future-issued sessions", () => {
    expect(hasRecentAuthentication(session, 1_001 + STEP_UP_MAX_AGE_SECONDS)).toBe(false);
    expect(hasRecentAuthentication(session, 999)).toBe(false);
  });
});
