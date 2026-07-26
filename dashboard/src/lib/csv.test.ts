import { describe, expect, it } from "vitest";
import { csvCell } from "./csv";

describe("CSV export safety", () => {
  it("neutralizes spreadsheet formula prefixes and escapes quotes", () => {
    expect(csvCell("=HYPERLINK(\"https://attacker.invalid\")")).toBe("\"'=HYPERLINK(\"\"https://attacker.invalid\"\")\"");
    expect(csvCell("+cmd")).toBe("\"'+cmd\"");
    expect(csvCell("ordinary")).toBe("\"ordinary\"");
  });
});
