#!/usr/bin/env bash
set -euo pipefail

if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  echo "Use ./bootstrap.sh, ./dev.sh, or ./build.sh instead." >&2
  exit 1
fi

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
FRONTEND_DIR="$ROOT_DIR/frontend"
BUILD_DIR="$ROOT_DIR/build"
MACOS_BUNDLE_ID="com.tiny.tinyxdownloader"
MACOS_TARGET_PLATFORM="darwin/arm64"

host_os() {
  uname -s | tr '[:upper:]' '[:lower:]'
}

wails_config_value() {
  local key_path="$1"

  node -e '
const fs = require("node:fs");
const [configPath, keyPath] = process.argv.slice(1);
let value = JSON.parse(fs.readFileSync(configPath, "utf8"));
for (const key of keyPath.split(".")) {
  value = value[key];
}
if (typeof value === "boolean") {
  process.stdout.write(value ? "true\n" : "false\n");
} else {
  process.stdout.write(String(value) + "\n");
}
' "$ROOT_DIR/wails.json" "$key_path"
}

app_name() {
  wails_config_value "info.productName"
}

app_version() {
  wails_config_value "info.productVersion"
}

app_output_name() {
  wails_config_value "outputfilename"
}

log_step() {
  printf '\n==> %s\n' "$1"
}

fail() {
  printf 'Error: %s\n' "$1" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "Missing required command: $1"
}

run_with_retries() {
  local attempts="$1"
  local delay_seconds="$2"
  shift 2

  local attempt=1
  while true; do
    if "$@"; then
      return 0
    fi

    local status="$?"
    if (( attempt >= attempts )); then
      return "$status"
    fi

    log_step "Command failed (attempt ${attempt}/${attempts}); retrying in ${delay_seconds}s"
    sleep "$delay_seconds"
    attempt=$((attempt + 1))
  done
}

normalize_macos_toolchain() {
  if [[ "$(host_os)" != "darwin" ]]; then
    return 0
  fi

  if [[ -n "${CC:-}" ]] && ! command -v "$CC" >/dev/null 2>&1; then
    export CC="clang"
  elif [[ -z "${CC:-}" ]]; then
    export CC="clang"
  fi

  if [[ -n "${CXX:-}" ]] && ! command -v "$CXX" >/dev/null 2>&1; then
    export CXX="clang++"
  elif [[ -z "${CXX:-}" ]]; then
    export CXX="clang++"
  fi
}

resolve_wails_version() {
  (
    cd "$ROOT_DIR"
    go list -m -f '{{.Version}}' github.com/wailsapp/wails/v2
  )
}

run_wails() {
  local wails_version
  wails_version="$(resolve_wails_version)"

  (
    cd "$ROOT_DIR"
    run_with_retries 3 5 go run "github.com/wailsapp/wails/v2/cmd/wails@${wails_version}" "$@"
  )
}

ensure_frontend_dependencies() {
  log_step "Installing frontend dependencies"
  (
    cd "$FRONTEND_DIR"
    pnpm install --frozen-lockfile
  )
}

ensure_embed_inputs() {
  mkdir -p "$ROOT_DIR/frontend/dist"
  if [[ ! -f "$ROOT_DIR/frontend/dist/.gitkeep" ]]; then
    touch "$ROOT_DIR/frontend/dist/.gitkeep"
  fi
}

generate_wails_bindings() {
  log_step "Generating Wails JS bindings"
  run_wails generate module
}

bootstrap_project() {
  normalize_macos_toolchain
  require_command go
  require_command node
  require_command pnpm

  ensure_frontend_dependencies
  ensure_embed_inputs
  generate_wails_bindings
}
