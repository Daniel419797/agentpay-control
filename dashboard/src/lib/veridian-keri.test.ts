import { afterEach, describe, expect, it, vi } from "vitest";
import { verifyVeridianCredential, veridianKeriConfigFromEnv, type VeridianKeriConfig } from "@/lib/veridian-keri";

const issuer = "E".repeat(44);
const schema = "E".repeat(43) + "A";
const subject = "E".repeat(43) + "B";
const credential = { d: "E".repeat(43) + "C", i: issuer, s: schema, a: { i: subject } };
const verificationConfig: VeridianKeriConfig = {
  verifyUrl: "https://keria.example.com/credentials/verify",
  timeoutMs: 10_000,
  trustedIssuerAids: [issuer],
  allowedSchemaSaids: [schema],
};

afterEach(() => vi.unstubAllGlobals());

describe("Veridian/KERI configuration", () => {
  it("fails closed without production issuer and schema allowlists", () => {
    expect(() => veridianKeriConfigFromEnv({ APP_ENV: "production", VERIDIAN_KERIA_CREDENTIAL_VERIFY_URL: "https://keria.example.com/credentials/verify" })).toThrow("VERIDIAN_TRUSTED_ISSUER_AIDS_REQUIRED");
    expect(() => veridianKeriConfigFromEnv({ APP_ENV: "production", VERIDIAN_KERIA_CREDENTIAL_VERIFY_URL: "https://keria.example.com/credentials/verify", VERIDIAN_TRUSTED_ISSUER_AIDS: issuer })).toThrow("VERIDIAN_ALLOWED_SCHEMA_SAIDS_REQUIRED");
  });

  it("rejects plaintext production verification endpoints", () => {
    expect(() => veridianKeriConfigFromEnv({ APP_ENV: "production", VERIDIAN_KERIA_CREDENTIAL_VERIFY_URL: "http://keria.example.com/credentials/verify", VERIDIAN_TRUSTED_ISSUER_AIDS: issuer, VERIDIAN_ALLOWED_SCHEMA_SAIDS: schema })).toThrow("VERIDIAN_KERIA_HTTPS_REQUIRED");
  });

  it("accepts explicitly pinned production trust", () => {
    const config = veridianKeriConfigFromEnv({ APP_ENV: "production", VERIDIAN_KERIA_CREDENTIAL_VERIFY_URL: "https://keria.example.com/credentials/verify", VERIDIAN_TRUSTED_ISSUER_AIDS: issuer, VERIDIAN_ALLOWED_SCHEMA_SAIDS: schema });
    expect(config.trustedIssuerAids).toEqual([issuer]);
    expect(config.allowedSchemaSaids).toEqual([schema]);
  });

  it("rejects an HTTP-successful verifier response without an explicit positive verdict", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ status: "accepted" }), { status: 200, headers: { "content-type": "application/json" } })));
    await expect(verifyVeridianCredential(credential, verificationConfig)).rejects.toThrow("VERIDIAN_CREDENTIAL_NOT_VERIFIED");
  });

  it("rejects an explicit negative verification verdict", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ verified: false }), { status: 200, headers: { "content-type": "application/json" } })));
    await expect(verifyVeridianCredential(credential, verificationConfig)).rejects.toThrow("VERIDIAN_CREDENTIAL_NOT_VERIFIED");
  });

  it("accepts an explicit positive verification verdict from pinned trust", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ verified: true, revoked: false }), { status: 200, headers: { "content-type": "application/json" } })));
    const result = await verifyVeridianCredential(credential, verificationConfig);
    expect(result.credentialSaid).toBe(credential.d);
    expect(result.subjectAid).toBe(subject);
    expect(result.revoked).toBe(false);
  });
});
