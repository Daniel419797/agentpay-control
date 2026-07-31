import { defineConfig } from "@playwright/test";

const browserChannel = process.env.PLAYWRIGHT_CHANNEL;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: "html",
  use: {
    baseURL: "http://localhost:3100",
    trace: "on-first-retry",
    ...(browserChannel ? { channel: browserChannel } : {}),
  },
  webServer: {
    command: process.env.CI ? "npm run start -- -p 3100" : "npm run dev -- -p 3100",
    port: 3100,
    reuseExistingServer: !process.env.CI,
  },
});
