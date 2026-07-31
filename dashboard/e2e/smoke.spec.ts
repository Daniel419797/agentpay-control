import { test, expect } from "@playwright/test";

test.describe("AgentPay Control Dashboard", () => {
  test("loads sign-in page", async ({ page }) => {
    await page.goto("/sign-in");
    await expect(page.getByRole("img", { name: "AgentPay" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Operator sign in" })).toBeVisible();
  });

  test("redirects unauthenticated overview requests to sign in", async ({ page }) => {
    await page.goto("/app/overview");
    await expect(page).toHaveURL(/\/sign-in/);
  });
});
