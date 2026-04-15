# X Bookmarks Cleanup

This repo includes a two-step local workflow for clearing `x.com` bookmarks with your own browser session:

1. export decrypted Chrome cookies into a local JSON file
2. run the Playwright cleanup tool against that cookies file

The public entrypoint is [`bookmarks.sh`](../bookmarks.sh). It keeps the toolchain in one place while reusing the existing Python and Playwright implementations underneath.

## Files

- Cookie export script:
  [`scripts/export_chrome_x_cookies.py`](../scripts/export_chrome_x_cookies.py)
- Bookmark cleanup script:
  [`frontend/scripts/clear-x-bookmarks-playwright.mjs`](../frontend/scripts/clear-x-bookmarks-playwright.mjs)
- Root wrapper:
  [`bookmarks.sh`](../bookmarks.sh)

## Quick Start

Export cookies once:

```bash
./bookmarks.sh export-cookies --name auth_token --name ct0 --name twid --pretty
```

Verify the session before deleting anything:

```bash
./bookmarks.sh dry-run --expected-handle Tiny_MOD
```

Run the cleanup:

```bash
./bookmarks.sh clear --headless
```

## Step 1: Export Cookies

Run this from the project root:

```bash
./bookmarks.sh export-cookies \
  --name auth_token \
  --name ct0 \
  --name twid \
  --pretty
```

Notes:

- On the first run, macOS may ask for permission to access `Chrome Safe Storage`.
- The default output file is `chrome-x-cookies.json` in the repo root.
- If your logged-in X session changes, rerun the export command to refresh the cookies file.

## Step 2: Dry Run

This checks that the cookies still work and that the current account matches `Tiny_MOD`.

```bash
./bookmarks.sh dry-run --expected-handle Tiny_MOD
```

## Step 3: Clear Bookmarks

Headless full cleanup:

```bash
./bookmarks.sh clear --headless
```

Visible browser window:

```bash
./bookmarks.sh clear
```

Limit the run for testing:

```bash
./bookmarks.sh clear --limit 20
```

## Defaults

By default the cleanup script:

- reads cookies from `chrome-x-cookies.json`
- opens:
  [https://x.com/i/bookmarks](https://x.com/i/bookmarks)
- verifies the logged-in handle is `Tiny_MOD`
- saves run screenshots under `tmp/bookmarks/`
- uses the first available delete path:
  - direct `[data-testid="removeBookmark"]`
  - fallback `caret -> Delete bookmark / 从书签中移除`

## Validation and Screenshots

Every run now leaves simple artifacts behind:

- `before` screenshot after login validation passes
- `after` screenshot after final verification completes
- `error` screenshot on browser-side failures

The cleanup step also prints a final verification line with:

- whether the empty-state was detected
- how many visible `removeBookmark` controls remained after reloading the bookmarks page

Full cleanup mode exits non-zero if verification still shows visible remaining bookmarks. `--dry-run` and `--limit` intentionally allow residual bookmarks.

## Useful Options

```bash
--expected-handle Tiny_MOD
--cookies-file /absolute/path/to/chrome-x-cookies.json
--limit 50
--headless
--dry-run
--slow-ms 400
```

## Legacy Token Mode

The cleanup script still supports explicit token mode for debugging, but it is no longer the default:

```bash
./bookmarks.sh clear --cookies-file '' --token-file ~/.twitterxmediabatchdownloader/auth_tokens.json --token-kind private
```

The recommended path is still:

1. export cookies once
2. reuse `chrome-x-cookies.json`

## Safety Notes

- The script is designed for your own logged-in session only.
- It stops if the logged-in handle does not match the expected handle.
- Cookie export writes sensitive session data to a local file, so keep `chrome-x-cookies.json` private and delete it when you no longer need it.
