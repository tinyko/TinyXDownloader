#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
source "$ROOT_DIR/scripts/common.sh"

export PATH="/opt/homebrew/bin:$PATH"

if [[ "$(host_os)" != "darwin" ]]; then
  fail "./scripts/desktop-smoke.sh must be run on macOS"
fi

SMOKE_OUTPUT_DIR="${SMOKE_OUTPUT_DIR:-$ROOT_DIR/build/desktop-smoke}"
SMOKE_TIMEOUT_SECONDS="${SMOKE_TIMEOUT_SECONDS:-120}"
SEEDED_DB_PATH="$ROOT_DIR/frontend/tests/e2e/fixtures/saved-accounts.seed.sqlite"
APP_NAME="$(app_output_name)"
APP_PATH="$ROOT_DIR/build/bin/${APP_NAME}.app"
APP_EXECUTABLE="$APP_PATH/Contents/MacOS/${APP_NAME}"
APPDATA_DIR="$SMOKE_OUTPUT_DIR/appdata"
REPORT_PATH="$SMOKE_OUTPUT_DIR/report.json"
STDOUT_LOG_PATH="$SMOKE_OUTPUT_DIR/app.stdout.log"
SCREENSHOT_PATH="$SMOKE_OUTPUT_DIR/failure-screen.png"

[[ -f "$SEEDED_DB_PATH" ]] || fail "Missing seeded smoke database: $SEEDED_DB_PATH"

rm -rf "$SMOKE_OUTPUT_DIR"
mkdir -p "$APPDATA_DIR"
cp "$SEEDED_DB_PATH" "$APPDATA_DIR/accounts.db"

cleanup() {
  if [[ -n "${APP_PID:-}" ]] && kill -0 "$APP_PID" >/dev/null 2>&1; then
    kill "$APP_PID" >/dev/null 2>&1 || true
    wait "$APP_PID" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

log_step "Building desktop app for smoke"
"$ROOT_DIR/build.sh" -platform "$MACOS_TARGET_PLATFORM"

[[ -x "$APP_EXECUTABLE" ]] || fail "Missing built app executable: $APP_EXECUTABLE"

log_step "Launching desktop smoke app"
XDOWNLOADER_SMOKE_MODE=1 \
XDOWNLOADER_APPDATA_DIR="$APPDATA_DIR" \
XDOWNLOADER_SMOKE_REPORT_PATH="$REPORT_PATH" \
"$APP_EXECUTABLE" >"$STDOUT_LOG_PATH" 2>&1 &
APP_PID=$!

deadline=$(( $(date +%s) + SMOKE_TIMEOUT_SECONDS ))
while [[ $(date +%s) -lt "$deadline" ]]; do
  if [[ -f "$REPORT_PATH" ]]; then
    break
  fi
  if ! kill -0 "$APP_PID" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

if [[ ! -f "$REPORT_PATH" ]]; then
  if command -v screencapture >/dev/null 2>&1; then
    screencapture -x "$SCREENSHOT_PATH" || true
  fi
  fail "Desktop smoke did not produce a report within ${SMOKE_TIMEOUT_SECONDS}s"
fi

if ! python3 - <<'PY' "$REPORT_PATH"
import json
import sys
from pathlib import Path

report = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
if report.get("ok"):
    print("Desktop smoke passed:", ", ".join(report.get("steps", [])))
    raise SystemExit(0)

print("Desktop smoke failed:", report.get("error", "unknown error"), file=sys.stderr)
print(json.dumps(report, indent=2), file=sys.stderr)
raise SystemExit(1)
PY
then
  if command -v screencapture >/dev/null 2>&1; then
    screencapture -x "$SCREENSHOT_PATH" || true
  fi
  exit 1
fi

log_step "Desktop smoke artifacts"
printf 'Report: %s\n' "$REPORT_PATH"
printf 'Stdout log: %s\n' "$STDOUT_LOG_PATH"
