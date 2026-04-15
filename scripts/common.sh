#!/usr/bin/env bash
set -euo pipefail

if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  echo "Use ./bootstrap.sh, ./dev.sh, or ./build.sh instead." >&2
  exit 1
fi

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
FRONTEND_DIR="$ROOT_DIR/frontend"
HELPER_DIR="$ROOT_DIR/helper"
BUILD_DIR="$ROOT_DIR/build"
PYTHON_VENV_DIR="$BUILD_DIR/python-venv"
PYTHON_BIN="$PYTHON_VENV_DIR/bin/python"
PYTHON_STAMP="$PYTHON_VENV_DIR/.requirements.stamp"
MACOS_BUNDLE_ID="com.tiny.tinyxdownloader"
MACOS_TARGET_PLATFORM="darwin/arm64"

host_os() {
  case "$(uname -s)" in
    Darwin)
      echo "darwin"
      ;;
    Linux)
      echo "linux"
      ;;
    MINGW*|MSYS*|CYGWIN*)
      echo "windows"
      ;;
    *)
      echo "unsupported"
      ;;
  esac
}

extractor_name() {
  case "$(host_os)" in
    windows)
      echo "extractor.exe"
      ;;
    darwin|linux)
      echo "extractor"
      ;;
    *)
      echo "extractor"
      ;;
  esac
}

EXTRACTOR_OUTPUT="$ROOT_DIR/backend/bin/$(extractor_name)"

wails_config_value() {
  local key_path="$1"

  python3 - "$ROOT_DIR/wails.json" "$key_path" <<'PY'
import json
import sys

config_path, key_path = sys.argv[1], sys.argv[2]

with open(config_path, "r", encoding="utf-8") as f:
    value = json.load(f)

for key in key_path.split("."):
    value = value[key]

if isinstance(value, bool):
    print("true" if value else "false")
else:
    print(value)
PY
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
    go run "github.com/wailsapp/wails/v2/cmd/wails@${wails_version}" "$@"
  )
}

ensure_frontend_dependencies() {
  log_step "Installing frontend dependencies"
  (
    cd "$FRONTEND_DIR"
    pnpm install --frozen-lockfile
  )
}

ensure_python_venv() {
  if [[ ! -x "$PYTHON_BIN" ]]; then
    log_step "Creating local Python build environment"
    python3 -m venv "$PYTHON_VENV_DIR"
  fi

  if [[ ! -f "$PYTHON_STAMP" || "$HELPER_DIR/requirements-build.txt" -nt "$PYTHON_STAMP" ]]; then
    log_step "Installing extractor build dependencies"
    "$PYTHON_BIN" -m pip install --upgrade pip
    "$PYTHON_BIN" -m pip install -r "$HELPER_DIR/requirements-build.txt"
    touch "$PYTHON_STAMP"
  fi
}

ensure_embed_inputs() {
  mkdir -p "$ROOT_DIR/frontend/dist"
  mkdir -p "$(dirname "$EXTRACTOR_OUTPUT")"
  if [[ ! -f "$ROOT_DIR/frontend/dist/.gitkeep" ]]; then
    touch "$ROOT_DIR/frontend/dist/.gitkeep"
  fi
}

extractor_needs_rebuild() {
  if [[ ! -f "$EXTRACTOR_OUTPUT" ]]; then
    return 0
  fi

  local source
  for source in \
    "$HELPER_DIR/twitter_cli.py" \
    "$HELPER_DIR/twitter_common.py" \
    "$HELPER_DIR/requirements-build.txt"
  do
    if [[ "$source" -nt "$EXTRACTOR_OUTPUT" ]]; then
      return 0
    fi
  done

  return 1
}

build_extractor() {
  if ! extractor_needs_rebuild; then
    log_step "Extractor binary is already up to date"
    return 0
  fi

  log_step "Building extractor binary"
  rm -rf "$BUILD_DIR/pyinstaller"
  mkdir -p "$BUILD_DIR/pyinstaller/work" "$BUILD_DIR/pyinstaller/spec"

  (
    cd "$HELPER_DIR"
    "$PYTHON_BIN" -m PyInstaller \
      --noconfirm \
      --clean \
      --onefile \
      --name extractor \
      --distpath "$ROOT_DIR/backend/bin" \
      --workpath "$BUILD_DIR/pyinstaller/work" \
      --specpath "$BUILD_DIR/pyinstaller/spec" \
      --collect-all gallery_dl \
      twitter_cli.py
  )

  [[ -f "$EXTRACTOR_OUTPUT" ]] || fail "Extractor build finished without producing $(basename "$EXTRACTOR_OUTPUT")"

  if [[ "$(host_os)" != "windows" ]]; then
    chmod +x "$EXTRACTOR_OUTPUT"
  fi
}

generate_wails_bindings() {
  log_step "Generating Wails JS bindings"
  run_wails generate module
}

bootstrap_project() {
  normalize_macos_toolchain
  require_command go
  require_command pnpm
  require_command python3

  ensure_frontend_dependencies
  ensure_python_venv
  ensure_embed_inputs
  build_extractor
  generate_wails_bindings
}
