import { describe, expect, it } from "vitest";
import { veridianKeriConfigFromEnv } from "@/lib/veridian-keri";

const issuer = "E".repeat(44);
const schema = "E".repeat(43) + "A";

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
});
