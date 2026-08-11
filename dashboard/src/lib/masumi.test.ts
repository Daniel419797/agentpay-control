import { describe, expect, it } from "vitest";

import { assertMasumiEntryMatches, masumiConfigFromEnv, masumiMetadataHash, type MasumiEntry } from "@/lib/masumi";

const entry: MasumiEntry = {
  id: "entry-1",
  name: "Research Agent",
  description: "Research",
  status: "Online",
  apiBaseUrl: "https://agent.example.com/api/",
  paymentType: "Web3CardanoV2",
  agentIdentifier: "a".repeat(64),
  RegistrySource: { policyId: "b".repeat(56), url: "https://registry.example.com/source" },
  Capability: { name: "web-research", version: "1.0.0" },
  metadataVersion: 1,
  tags: ["research"],
};

describe("Masumi registry trust", () => {
  it("requires HTTPS and a scoped key in production", () => {
    expect(() => masumiConfigFromEnv({ APP_ENV: "production", MASUMI_REGISTRY_URL: "http://registry.example.com/api/v1", MASUMI_REGISTRY_API_KEY: "x".repeat(32) })).toThrow("MASUMI_HTTPS_REQUIRED");
    expect(() => masumiConfigFromEnv({ APP_ENV: "production", MASUMI_REGISTRY_URL: "https://registry.example.com/api/v1" })).toThrow("MASUMI_REGISTRY_API_KEY_REQUIRED");
  });

  it("binds an online registry identity to the paid resource URL and capability", () => {
    expect(() => assertMasumiEntryMatches(entry, {
      network: "Mainnet",
      agentIdentifier: entry.agentIdentifier,
      resourceUrl: "https://agent.example.com/api/start_job",
      allowedCapabilities: ["web-research"],
    })).not.toThrow();
    expect(() => assertMasumiEntryMatches(entry, {
      network: "Mainnet",
      agentIdentifier: entry.agentIdentifier,
      resourceUrl: "https://attacker.example.com/api/start_job",
      allowedCapabilities: ["web-research"],
    })).toThrow("MASUMI_RESOURCE_URL_MISMATCH");
    expect(() => assertMasumiEntryMatches(entry, {
      network: "Mainnet",
      agentIdentifier: entry.agentIdentifier,
      resourceUrl: "https://agent.example.com/api/start_job",
      allowedCapabilities: ["image-generation"],
    })).toThrow("MASUMI_CAPABILITY_NOT_ALLOWED");
  });

  it("hashes the trust-relevant registry metadata deterministically", () => {
    expect(masumiMetadataHash(entry)).toMatch(/^[0-9a-f]{64}$/);
    expect(masumiMetadataHash({ ...entry, name: "Display name may change" })).toBe(masumiMetadataHash(entry));
    expect(masumiMetadataHash({ ...entry, status: "Offline" })).not.toBe(masumiMetadataHash(entry));
  });
});
