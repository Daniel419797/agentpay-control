import { describe, expect, it } from "vitest";
import { classifyResourceHealth } from "./resource-health-service";

describe("classifyResourceHealth", () => {
  it("recognizes a payment challenge as healthy", () => expect(classifyResourceHealth(402, 80, 500)).toBe("HEALTHY"));
  it("marks throttling and SLA latency as degraded", () => { expect(classifyResourceHealth(429, 20, 500)).toBe("DEGRADED"); expect(classifyResourceHealth(200, 800, 500)).toBe("DEGRADED"); });
  it("marks server and transport failures down", () => { expect(classifyResourceHealth(503, 30, 500)).toBe("DOWN"); expect(classifyResourceHealth(undefined, 5_000, 500)).toBe("DOWN"); });
});
