#!/usr/bin/env node

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright-core";

const DEFAULT_EXPECTED_HANDLE = "Tiny_MOD";
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..", "..");
const DEFAULT_COOKIES_FILE = path.join(REPO_ROOT, "chrome-x-cookies.json");
const DEFAULT_TOKEN_FILE = path.join(
  os.homedir(),
  ".twitterxmediabatchdownloader",
  "auth_tokens.json"
);
const DEFAULT_BOOKMARKS_URL = "https://x.com/i/bookmarks";
const SCREENSHOT_DIR = path.join(REPO_ROOT, "tmp", "bookmarks");
const CHROME_CANDIDATES = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
];

function printUsage() {
  console.log(`
Clear X bookmarks with Playwright using exported Chrome cookies.

Usage:
  ./bookmarks.sh clear [options]
  ./bookmarks.sh dry-run [options]
  pnpm run clear-bookmarks -- [options]

Options:
  --expected-handle <handle>   Abort unless the logged-in handle matches (default: Tiny_MOD)
  --cookies-file <path>        Exported cookies JSON path (default: repo-root chrome-x-cookies.json)
  --token-file <path>          Legacy fallback: auth token JSON path
  --token-kind <kind>          Token key to use: private | public (default: private)
  --chrome <path>              Override Chrome executable path
  --limit <n>                  Stop after deleting N bookmarks (default: 0 = all)
  --headless                   Run without opening the browser window
  --dry-run                    Only verify login + count visible bookmarked items
  --slow-ms <n>                Delay between delete clicks in ms (default: 400)
  --help                       Show this help

Examples:
  ./bookmarks.sh dry-run --expected-handle Tiny_MOD
  ./bookmarks.sh clear --headless
  ./bookmarks.sh clear --expected-handle Tiny_MOD --limit 50
  pnpm run clear-bookmarks -- --cookies-file ../chrome-x-cookies.json --headless
`.trim());
}

function parseArgs(argv) {
  const options = {
    expectedHandle: DEFAULT_EXPECTED_HANDLE,
    cookiesFile: DEFAULT_COOKIES_FILE,
    tokenFile: DEFAULT_TOKEN_FILE,
    tokenKind: "private",
    chromePath: "",
    limit: 0,
    headless: false,
    dryRun: false,
    slowMs: 400,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];

    switch (arg) {
      case "--":
        break;
      case "--expected-handle":
        options.expectedHandle = next ?? "";
        i += 1;
        break;
      case "--cookies-file":
        options.cookiesFile = next ?? "";
        i += 1;
        break;
      case "--token-file":
        options.tokenFile = next ?? "";
        i += 1;
        break;
      case "--token-kind":
        options.tokenKind = next ?? "";
        i += 1;
        break;
      case "--chrome":
        options.chromePath = next ?? "";
        i += 1;
        break;
      case "--limit":
        options.limit = Number.parseInt(next ?? "0", 10);
        i += 1;
        break;
      case "--slow-ms":
        options.slowMs = Number.parseInt(next ?? "400", 10);
        i += 1;
        break;
      case "--headless":
        options.headless = true;
        break;
      case "--dry-run":
        options.dryRun = true;
        break;
      case "--help":
      case "-h":
        options.help = true;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!["private", "public"].includes(options.tokenKind)) {
    throw new Error(`--token-kind must be "private" or "public", got "${options.tokenKind}"`);
  }
  if (!Number.isFinite(options.limit) || options.limit < 0) {
    throw new Error(`--limit must be a non-negative integer, got "${options.limit}"`);
  }
  if (!Number.isFinite(options.slowMs) || options.slowMs < 0) {
    throw new Error(`--slow-ms must be a non-negative integer, got "${options.slowMs}"`);
  }

  return options;
}

function normalizeHandle(value) {
  return String(value || "")
    .trim()
    .replace(/^@+/, "")
    .toLowerCase();
}

async function loadAuthToken(tokenFile, tokenKind) {
  const raw = await fs.readFile(tokenFile, "utf8");
  const parsed = JSON.parse(raw);
  const key = tokenKind === "public" ? "public_token" : "private_token";
  const token = String(parsed?.[key] || "").trim();

  if (!token) {
    throw new Error(`No ${key} found in ${tokenFile}`);
  }

  return token;
}

function normalizeSameSite(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "strict") {
    return "Strict";
  }
  if (normalized === "lax") {
    return "Lax";
  }
  return "None";
}

async function loadCookiesFromFile(cookiesFile) {
  const raw = await fs.readFile(cookiesFile, "utf8");
  const parsed = JSON.parse(raw);
  const cookies = Array.isArray(parsed) ? parsed : parsed?.cookies;

  if (!Array.isArray(cookies) || cookies.length === 0) {
    throw new Error(`No cookies array found in ${cookiesFile}`);
  }

  return cookies
    .filter((cookie) => cookie && cookie.name && cookie.value && cookie.domain)
    .map((cookie) => ({
      name: String(cookie.name),
      value: String(cookie.value),
      domain: String(cookie.domain),
      path: String(cookie.path || "/"),
      secure: Boolean(cookie.secure),
      httpOnly: Boolean(cookie.httpOnly),
      sameSite: normalizeSameSite(cookie.sameSite),
    }));
}

async function loadContextCookies(options) {
  if (options.cookiesFile) {
    return loadCookiesFromFile(options.cookiesFile);
  }

  const authToken = await loadAuthToken(options.tokenFile, options.tokenKind);
  return [
    {
      name: "auth_token",
      value: authToken,
      domain: ".x.com",
      path: "/",
      httpOnly: true,
      secure: true,
      sameSite: "None",
    },
  ];
}

async function resolveChromeExecutable(explicitPath) {
  if (explicitPath) {
    await fs.access(explicitPath);
    return explicitPath;
  }

  for (const candidate of CHROME_CANDIDATES) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      // Keep checking candidates.
    }
  }

  throw new Error(
    "Could not find a Chrome/Chromium executable. Pass one with --chrome /path/to/browser"
  );
}

async function installPageOptimizations(page) {
  await page.route("**/*", async (route) => {
    const resourceType = route.request().resourceType();
    if (resourceType === "image" || resourceType === "media" || resourceType === "font") {
      await route.abort();
      return;
    }
    await route.continue();
  });
}

async function waitForAuthenticatedShell(page) {
  await page.goto(DEFAULT_BOOKMARKS_URL, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle").catch(() => {});

  if (page.url().includes("/login")) {
    throw new Error(
      "X redirected to login. The cookies file may be stale, incomplete, or tied to a different account."
    );
  }

  const profileLink = page.locator('a[data-testid="AppTabBar_Profile_Link"]').first();
  await profileLink.waitFor({ state: "visible", timeout: 20_000 });
  return profileLink;
}

async function getCurrentHandle(page) {
  const profileLink = await waitForAuthenticatedShell(page);
  const href = await profileLink.getAttribute("href");
  if (!href) {
    throw new Error("Could not determine the current X handle from the profile link.");
  }

  return href.replace(/^\/+/, "").split(/[/?#]/, 1)[0];
}

async function countVisibleRemoveButtons(page) {
  return page.locator('[data-testid="removeBookmark"]').evaluateAll((elements) =>
    elements.filter((element) => {
      if (!(element instanceof HTMLElement)) {
        return false;
      }
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return (
        style.visibility !== "hidden" &&
        style.display !== "none" &&
        rect.width > 0 &&
        rect.height > 0
      );
    }).length
  );
}

async function isBookmarksEmpty(page) {
  const emptyTexts = [
    "Save posts for later",
    "You haven’t added any posts to your Bookmarks yet",
    "You haven't added any posts to your Bookmarks yet",
  ];

  for (const text of emptyTexts) {
    if ((await page.getByText(text, { exact: false }).count()) > 0) {
      return true;
    }
  }
  return false;
}

function createRunStamp() {
  return new Date().toISOString().replaceAll(":", "-");
}

async function capturePhaseScreenshot(page, runStamp, phase) {
  await fs.mkdir(SCREENSHOT_DIR, { recursive: true });
  const filepath = path.join(
    SCREENSHOT_DIR,
    `x-bookmarks-${runStamp}-${phase}.png`
  );
  await page.screenshot({ path: filepath, fullPage: true });
  console.log(`[clear-bookmarks] ${phase} screenshot saved to ${filepath}`);
  return filepath;
}

async function clearBookmarks(page, options) {
  page.on("console", (message) => {
    const text = message.text();
    if (text.startsWith("__bookmark_cleaner__")) {
      console.log(`[clear-bookmarks] ${text.replace("__bookmark_cleaner__", "").trim()}`);
    }
  });

  const result = await page.evaluate(
    async ({ limit, slowMs, dryRun }) => {
      const DELETE_LABELS = [
        "Delete bookmark",
        "Remove Bookmark",
        "Remove bookmark",
        "从书签中移除",
        "删除书签",
      ];

      const EMPTY_HINTS = [
        "Save posts for later",
        "You haven’t added any posts to your Bookmarks yet",
        "You haven't added any posts to your Bookmarks yet",
      ];

      const sleep = (ms) => new Promise((resolve) => window.setTimeout(resolve, ms));

      const visible = (element) => {
        if (!(element instanceof HTMLElement)) {
          return false;
        }
        const style = window.getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return (
          style.visibility !== "hidden" &&
          style.display !== "none" &&
          rect.width > 0 &&
          rect.height > 0
        );
      };

      const log = (message) => console.log(`__bookmark_cleaner__ ${message}`);

      const getVisibleRemoveButton = () => {
        const buttons = Array.from(document.querySelectorAll('[data-testid="removeBookmark"]'));
        return buttons.find(visible) ?? null;
      };

      const getVisibleCaretButton = () => {
        const buttons = Array.from(document.querySelectorAll('[data-testid="caret"]'));
        return buttons.find(visible) ?? null;
      };

      const findDeleteMenuTarget = () => {
        const items = Array.from(document.querySelectorAll("[role='menuitem']"));
        for (const item of items) {
          if (!(item instanceof HTMLElement) || !visible(item)) {
            continue;
          }
          const text = item.innerText || item.textContent || "";
          if (DELETE_LABELS.some((label) => text.includes(label))) {
            return item;
          }
        }
        return null;
      };

      const pageLooksEmpty = () =>
        EMPTY_HINTS.some((hint) => document.body.innerText.includes(hint));

      const visibleRemoveCount = () =>
        Array.from(document.querySelectorAll('[data-testid="removeBookmark"]')).filter(visible).length;

      if (dryRun) {
        return {
          deleted: 0,
          visible: visibleRemoveCount(),
          finished: true,
          reason: "dry-run",
        };
      }

      let deleted = 0;
      let idleRounds = 0;

      while (limit === 0 || deleted < limit) {
        const directRemove = getVisibleRemoveButton();
        if (directRemove) {
          directRemove.click();
          deleted += 1;
          idleRounds = 0;
          if (deleted === 1 || deleted % 10 === 0) {
            log(`removed ${deleted}${limit ? ` / ${limit}` : ""}`);
          }
          await sleep(slowMs);
          continue;
        }

        const caret = getVisibleCaretButton();
        if (caret) {
          caret.click();
          await sleep(150);

          const deleteTarget = findDeleteMenuTarget();
          if (deleteTarget) {
            deleteTarget.click();
            deleted += 1;
            idleRounds = 0;
            if (deleted === 1 || deleted % 10 === 0) {
              log(`removed ${deleted}${limit ? ` / ${limit}` : ""}`);
            }
            await sleep(slowMs);
            continue;
          }

          document.body.click();
          await sleep(100);
        }

        if (pageLooksEmpty()) {
          return {
            deleted,
            visible: 0,
            finished: true,
            reason: "empty",
          };
        }

        idleRounds += 1;
        window.scrollBy({ top: Math.max(window.innerHeight * 0.9, 900), behavior: "instant" });
        await sleep(900);

        if (idleRounds >= 8) {
          return {
            deleted,
            visible: visibleRemoveCount(),
            finished: true,
            reason: "idle",
          };
        }
      }

      return {
        deleted,
        visible: visibleRemoveCount(),
        finished: true,
        reason: "limit",
      };
    },
    {
      limit: options.limit,
      slowMs: options.slowMs,
      dryRun: options.dryRun,
    }
  );

  return result;
}

async function inspectFinalState(page) {
  await waitForAuthenticatedShell(page);
  await page.waitForTimeout(500);

  return {
    empty: await isBookmarksEmpty(page),
    visible: await countVisibleRemoveButtons(page),
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printUsage();
    return;
  }

  const runStamp = createRunStamp();
  const contextCookies = await loadContextCookies(options);
  const executablePath = await resolveChromeExecutable(options.chromePath);

  if (options.cookiesFile) {
    console.log(`[clear-bookmarks] using cookies file: ${options.cookiesFile}`);
  } else {
    console.log(`[clear-bookmarks] using legacy token file: ${options.tokenFile}`);
  }
  console.log(`[clear-bookmarks] using browser: ${executablePath}`);

  const browser = await chromium.launch({
    executablePath,
    headless: options.headless,
  });

  const context = await browser.newContext({
    viewport: { width: 1440, height: 1024 },
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36",
  });

  await context.addCookies(contextCookies);

  const page = await context.newPage();
  await installPageOptimizations(page);

  try {
    const currentHandle = await getCurrentHandle(page);
    const expectedHandle = normalizeHandle(options.expectedHandle);

    console.log(`[clear-bookmarks] authenticated as @${currentHandle}`);

    if (expectedHandle && normalizeHandle(currentHandle) !== expectedHandle) {
      throw new Error(
        `Expected @${options.expectedHandle}, but the authenticated account is @${currentHandle}. Aborting.`
      );
    }

    await capturePhaseScreenshot(page, runStamp, "before");

    const visibleButtons = await countVisibleRemoveButtons(page);
    console.log(`[clear-bookmarks] visible bookmarked items in viewport: ${visibleButtons}`);

    const result = await clearBookmarks(page, options);
    if (result.reason === "dry-run") {
      console.log(
        `[clear-bookmarks] dry-run found ${result.visible} visible bookmarked items in the viewport.`
      );
      console.log("[clear-bookmarks] dry-run enabled; no bookmarks were removed.");
    }

    const finalState = await inspectFinalState(page);

    console.log(
      `[clear-bookmarks] final verification: empty=${finalState.empty ? "yes" : "no"}, visibleRemaining=${finalState.visible}`
    );

    await capturePhaseScreenshot(page, runStamp, "after");

    if (result.reason === "idle" && !finalState.empty) {
      console.log(
        `[clear-bookmarks] stopped after idle scrolls; removed ${result.deleted}, ${result.visible} visible bookmark controls remained before verification.`
      );
    }

    if (!options.dryRun) {
      console.log(`[clear-bookmarks] done. Removed ${result.deleted} bookmarked items.`);
    }

    const allowsResidual = options.dryRun || options.limit > 0;
    if (!allowsResidual && !finalState.empty && finalState.visible > 0) {
      throw new Error(
        `Final verification still shows ${finalState.visible} visible bookmarked items.`
      );
    }
  } catch (error) {
    await capturePhaseScreenshot(page, runStamp, "error").catch(() => "");
    throw error;
  } finally {
    await context.close();
    await browser.close();
  }
}

main().catch((error) => {
  console.error(`[clear-bookmarks] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
