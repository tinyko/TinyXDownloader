import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "@playwright/test";

import { PREVIEW_PORT } from "./tests/e2e/support/constants";
import { resolveBrowserExecutablePath } from "./tests/e2e/support/resolveBrowserExecutable";

const executablePath = resolveBrowserExecutablePath();
const CONFIG_DIR = path.dirname(fileURLToPath(import.meta.url));
const PNPM_BIN = process.env.PNPM_BIN || "pnpm";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  globalSetup: "./tests/e2e/support/global-setup.ts",
  use: {
    baseURL: `http://127.0.0.1:${PREVIEW_PORT}`,
    headless: true,
    viewport: {
      width: 1600,
      height: 1200,
    },
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    launchOptions: executablePath
      ? {
          executablePath,
        }
      : undefined,
  },
  webServer: {
    command: `${PNPM_BIN} exec vite preview --host 127.0.0.1 --port ${PREVIEW_PORT} --strictPort`,
    cwd: CONFIG_DIR,
    env: {
      ...process.env,
      PATH: process.env.PATH || "/opt/homebrew/bin:/usr/bin:/bin",
    },
    port: PREVIEW_PORT,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
