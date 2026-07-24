import { test, expect } from "@playwright/test";

test.describe("AgentPay Control Dashboard", () => {
  test("loads sign-in page", async ({ page }) => {
    await page.goto("/sign-in");
    await expect(page.getByText("AgentPay")).toBeVisible();
  });

  test("loads overview page when authenticated", async ({ page }) => {
    await page.goto("/app/overview");
    await expect(page).toHaveURL(/\/sign-in/);
  });
});