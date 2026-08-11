import { describe, expect, it } from "vitest";
import { paymentNetworkFromJson, ROOT_DISPATCH_BODY_LIMIT, targetForNetwork } from "./root-dispatch.js";

const networks = { hedera: "hedera:testnet", arc: "eip155:5042002", cardano: "cardano:preprod" };

function body(requirementNetwork: string, acceptedNetwork = requirementNetwork) {
  return JSON.stringify({ paymentRequirements: { network: requirementNetwork }, paymentPayload: { accepted: { network: acceptedNetwork } } });
}

describe("combined facilitator root dispatch", () => {
  it("requires the signed payload and requirement networks to match before routing", () => {
    expect(paymentNetworkFromJson(body("cardano:preprod"))).toBe("cardano:preprod");
    expect(() => paymentNetworkFromJson(body("cardano:preprod", "hedera:testnet"))).toThrow("NETWORK_BINDING_REQUIRED");
    expect(() => paymentNetworkFromJson(JSON.stringify({ paymentRequirements: { network: "cardano:preprod" } }))).toThrow("NETWORK_BINDING_REQUIRED");
  });

  it("rejects malformed and oversized dispatch bodies", () => {
    expect(() => paymentNetworkFromJson("{" )).toThrow("INVALID_JSON");
    expect(() => paymentNetworkFromJson("{}", ROOT_DISPATCH_BODY_LIMIT + 1)).toThrow("REQUEST_BODY_TOO_LARGE");
  });

  it("maps only exact configured network identifiers", () => {
    expect(targetForNetwork("hedera:testnet", networks)).toBe("hedera");
    expect(targetForNetwork("eip155:5042002", networks)).toBe("arc");
    expect(targetForNetwork("cardano:preprod", networks)).toBe("cardano");
    expect(targetForNetwork("cardano:mainnet", networks)).toBeNull();
  });
});
