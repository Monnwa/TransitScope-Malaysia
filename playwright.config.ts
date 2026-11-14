import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.TRANSITSCOPE_TEST_URL ?? "http://127.0.0.1:3000";
const executablePath = process.env.TRANSITSCOPE_TEST_CHROME;

export default defineConfig({
  testDir: "./e2e",
  // Preserve the old fixtures in place. These specs depend on retired dashboard request and response contracts.
  testIgnore: [
    "**/{background-bus-processing,bus-animation,bus-journey,bus-motion,departure-board,departures-alerts,evidence-reliability,gps-progress,linkbike,mrt-lines,passenger-copy,timetable-adherence,train-arrivals,train-positions}.spec.ts",
  ],
  use: { baseURL, trace: "on-first-retry", launchOptions: executablePath ? { executablePath } : undefined },
  webServer: process.env.TRANSITSCOPE_TEST_URL ? undefined : { command: "pnpm dev", url: baseURL, reuseExistingServer: true },
  projects: [
    { name: "desktop-chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile-chromium", use: { ...devices["Pixel 7"], browserName: "chromium" } },
  ],
});
