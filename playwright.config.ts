import { randomBytes } from "node:crypto";
import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.PLAYWRIGHT_PORT ?? 3100);
const baseURL = `http://127.0.0.1:${port}`;
const browserRequestKey = process.env.EDGEY_BROWSER_REQUEST_KEY ??= randomBytes(32).toString("hex");

export default defineConfig({
  testDir: "./tests/browser",
  forbidOnly: Boolean(process.env.CI),
  use: { baseURL, trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `pnpm start --hostname 127.0.0.1 --port ${port}`,
    url: baseURL,
    env: { NEXT_PUBLIC_SITE_URL: baseURL, EDGEY_REQUEST_HASH_KEY: browserRequestKey },
    reuseExistingServer: false,
  },
});
