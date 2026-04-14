import fs from "node:fs";

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

  throw new Error(
    [
      "Could not find a Chrome/Chromium executable for Playwright smoke tests.",
      "Set PLAYWRIGHT_CHROME_PATH or install Google Chrome / Chromium in /Applications.",
    ].join(" "),
  );
}
