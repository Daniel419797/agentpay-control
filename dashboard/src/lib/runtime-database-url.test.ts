import { describe, expect, it } from "vitest";
import { runtimeDatabaseUrl } from "@/lib/runtime-database-url";

describe("runtimeDatabaseUrl", () => {
  it("switches Supabase session pooler URLs to transaction mode for serverless runtimes", () => {
    const input = "postgresql://postgres.project:secret@aws-0-eu-west-1.pooler.supabase.com:5432/postgres?schema=public";
    const result = new URL(runtimeDatabaseUrl(input, true));

    expect(result.port).toBe("6543");
    expect(result.searchParams.get("schema")).toBe("public");
    expect(result.searchParams.get("pgbouncer")).toBe("true");
  });

  it("leaves local and non-Supabase database URLs unchanged", () => {
    const input = "postgresql://agentpay:agentpay@localhost:54329/agentpay?schema=public";
    expect(runtimeDatabaseUrl(input, true)).toBe(input);
  });

  it("leaves session mode unchanged outside serverless runtimes", () => {
    const input = "postgresql://postgres.project:secret@aws-0-eu-west-1.pooler.supabase.com:5432/postgres";
    expect(runtimeDatabaseUrl(input, false)).toBe(input);
  });
});
