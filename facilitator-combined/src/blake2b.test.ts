import { describe, expect, it } from "vitest";
import { blake2b } from "./blake2b.js";

describe("blake2b", () => {
  it("matches the BLAKE2b-256 empty-string vector", () => {
    expect(blake2b(Buffer.alloc(0), 32).toString("hex")).toBe("0e5751c026e543b2e8ab2eb06099daa1d1e5df47778f7787faab45cdf12fe3a8");
  });

  it("matches BLAKE2b-256 and BLAKE2b-224 vectors without truncating a 512-bit digest", () => {
    const input = Buffer.from("abc", "utf8");
    expect(blake2b(input, 32).toString("hex")).toBe("bddd813c634239723171ef3fee98579b94964e3bb1cb3e427262c8c068d52319");
    expect(blake2b(input, 28).toString("hex")).toBe("9bd237b02a29e43bdd6738afa5b53ff0eee178d6210b618e4511aec8");
  });
});
