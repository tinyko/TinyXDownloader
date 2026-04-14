import fs from "node:fs";
import { chromium } from "@playwright/test";

const CHROME_CANDIDATES = [
  process.env.PLAYWRIGHT_CHROME_PATH,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
].filter(Boolean) as string[];

export function resolveBrowserExecutablePath() {
  for (const candidate of CHROME_CANDIDATES) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  const playwrightChromiumPath = chromium.executablePath();
  if (playwrightChromiumPath && fs.existsSync(playwrightChromiumPath)) {
    return playwrightChromiumPath;
  }

  return undefined;
}
