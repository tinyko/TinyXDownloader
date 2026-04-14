#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
source "$ROOT_DIR/scripts/common.sh"

if [[ -d "/opt/homebrew/bin" ]]; then
  export PATH="/opt/homebrew/bin:$PATH"
fi

usage() {
  cat <<'EOF'
Usage:
  ./bookmarks.sh export-cookies [args]
  ./bookmarks.sh dry-run [args]
  ./bookmarks.sh clear [args]

Commands:
  export-cookies   Export Chrome X/Twitter cookies to ./chrome-x-cookies.json by default
  dry-run          Verify login, capture screenshots, and report bookmark visibility without deleting
  clear            Run the Playwright bookmark cleanup flow

Examples:
  ./bookmarks.sh export-cookies --name auth_token --name ct0 --name twid --pretty
  ./bookmarks.sh dry-run --expected-handle Tiny_MOD
  ./bookmarks.sh clear --headless --limit 20

Pass --help after a subcommand to see the underlying script options.
EOF
}

run_export_cookies() {
  require_command python3

  (
    cd "$ROOT_DIR"
    python3 "$ROOT_DIR/scripts/export_chrome_x_cookies.py" "$@"
  )
}

run_clear_bookmarks() {
  require_command node

  (
    cd "$ROOT_DIR"
    node "$ROOT_DIR/frontend/scripts/clear-x-bookmarks-playwright.mjs" "$@"
  )
}

main() {
  local command="${1:-}"
  if [[ $# -gt 0 ]]; then
    shift
  fi

  case "$command" in
    export-cookies)
      run_export_cookies "$@"
      ;;
    dry-run)
      run_clear_bookmarks --dry-run "$@"
      ;;
    clear)
      run_clear_bookmarks "$@"
      ;;
    --help|-h|"")
      usage
      ;;
    *)
      printf 'Unknown bookmarks command: %s\n\n' "$command" >&2
      usage >&2
      exit 1
      ;;
  esac
}

main "$@"
