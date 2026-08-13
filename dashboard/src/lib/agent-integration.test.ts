import { describe, expect, it } from "vitest";

import {
  INTEGRATION_CREDENTIAL_PREFIX,
  INTEGRATION_META,
  INTEGRATION_TYPES,
  integrationCredentialLabel,
  parseIntegrationCredentialLabel,
} from "@/lib/agent-integration";

describe("agent integrations", () => {
  it("has metadata for every supported integration", () => {
    for (const type of INTEGRATION_TYPES) {
      expect(INTEGRATION_META[type].name).toBeTruthy();
      expect(INTEGRATION_META[type].description).toBeTruthy();
      expect(INTEGRATION_META[type].transport).toBeTruthy();
    }
  });

  it("round-trips integration credential labels", () => {
    const label = integrationCredentialLabel("CODEX", "Engineering Codex");
    expect(label.startsWith(INTEGRATION_CREDENTIAL_PREFIX)).toBe(true);
    expect(parseIntegrationCredentialLabel(label)).toEqual({ type: "CODEX", name: "Engineering Codex" });
  });

  it("normalizes connection names and respects the credential label limit", () => {
    const label = integrationCredentialLabel("CLAUDE_CODE", "  Engineering    Claude Code with a very long descriptive connection name  ");
    expect(label.length).toBeLessThanOrEqual(80);
    expect(label).not.toContain("  ");
  });

  it("does not classify arbitrary credential labels as integrations", () => {
    expect(parseIntegrationCredentialLabel("production-agent-key")).toBeNull();
    expect(parseIntegrationCredentialLabel(`${INTEGRATION_CREDENTIAL_PREFIX}UNKNOWN:test`)).toBeNull();
  });
});
