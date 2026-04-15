import path from "node:path";
import { test, expect } from "@playwright/test";

import { installWailsHarness } from "./support/wails-harness";

test("capture latest main workspace screenshot for docs", async ({ page }) => {
  const outputPath = process.env.README_SCREENSHOT_PATH;
  test.skip(!outputPath, "README screenshot capture only runs when an output path is provided");

  await page.setViewportSize({ width: 1766, height: 1126 });
  await installWailsHarness(page, {
    defaultSettings: {
      downloadPath: "/tmp/xdownloader-readme-shot",
      proxy: "",
      sfxEnabled: false,
      rememberPublicToken: true,
      rememberPrivateToken: true,
      fetchMode: "single",
      mediaType: "all",
      includeRetweets: false,
      theme: "yellow",
      themeMode: "dark",
      fontFamily: "google-sans",
    },
  });

  await page.goto("/");
  await expect(page.getByTestId("workspace-tab-fetch")).toBeVisible();
  await expect(page.getByTestId("fetch-input-textarea")).toBeVisible();
  await expect(page.getByText("Fetch Workspace")).toBeVisible();
  await page.screenshot({
    path: path.resolve(outputPath),
    fullPage: false,
  });
});
