import { defineConfig, devices } from "@playwright/test";

const baseURL = "http://127.0.0.1:5274";

export default defineConfig({
  testDir: "./tests/browser",
  outputDir: "./test-results/browser",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  timeout: 90_000,
  expect: {
    timeout: 12_000,
  },
  reporter: [
    ["list"],
    ["html", { outputFolder: "playwright-report", open: "never" }],
  ],
  use: {
    baseURL,
    actionTimeout: 12_000,
    navigationTimeout: 20_000,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  webServer: {
    command: "npm run dev:browser",
    url: baseURL,
    reuseExistingServer: false,
    timeout: 30_000,
  },
  projects: [
    {
      name: "desktop-light",
      metadata: { theme: "light" },
      use: { ...devices["Desktop Chrome"], colorScheme: "light" },
    },
    {
      name: "desktop-dark",
      metadata: { theme: "dark" },
      use: { ...devices["Desktop Chrome"], colorScheme: "dark" },
    },
    {
      name: "mobile-light",
      metadata: { theme: "light" },
      use: { ...devices["Pixel 7"], colorScheme: "light" },
    },
    {
      name: "mobile-dark",
      metadata: { theme: "dark" },
      use: { ...devices["Pixel 7"], colorScheme: "dark" },
    },
  ],
});
