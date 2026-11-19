import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  use: {
    baseURL: "http://localhost:4174",
    // The installed Google Chrome, so no browser download is needed.
    channel: "chrome",
    viewport: { width: 1440, height: 900 },
  },
  webServer: {
    command: "pnpm build && pnpm preview --port 4174 --strictPort",
    url: "http://localhost:4174",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
