import { describe, expect, it } from "vitest";

import { workspaceHasRole } from "@/lib/workspace";

function workspaceWithRoles(roles: Array<"OWNER" | "OPERATOR" | "APPROVER" | "VIEWER" | "PROVIDER_ADMIN">) {
  return { membership: { roles } } as Parameters<typeof workspaceHasRole>[0];
}

describe("workspace role authorization", () => {
  it("allows a member with any explicitly accepted role", () => {
    expect(workspaceHasRole(workspaceWithRoles(["VIEWER", "APPROVER"]), ["APPROVER"])).toBe(true);
  });

  it("denies a member whose roles are outside the accepted set", () => {
    expect(workspaceHasRole(workspaceWithRoles(["VIEWER"]), ["OWNER", "OPERATOR"])).toBe(false);
  });

  it("fails closed for an empty role set", () => {
    expect(workspaceHasRole(workspaceWithRoles([]), ["OWNER"])).toBe(false);
  });
});
