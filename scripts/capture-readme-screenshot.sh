#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
source "$ROOT_DIR/scripts/common.sh"

require_command node
require_command pnpm

CAPTURE_DATE="${CAPTURE_DATE:-$(date +%F)}"
OUTPUT_PATH="${1:-$ROOT_DIR/docs/images/workspace-${CAPTURE_DATE}.png}"

mkdir -p "$(dirname "$OUTPUT_PATH")"

log_step "Building frontend for README screenshot"
pnpm --dir "$ROOT_DIR/frontend" build

log_step "Capturing README workspace screenshot"
README_SCREENSHOT_PATH="$OUTPUT_PATH" \
  pnpm --dir "$ROOT_DIR/frontend" exec playwright test tests/e2e/readme-screenshot.spec.ts

printf 'README screenshot written to %s\n' "$OUTPUT_PATH"
