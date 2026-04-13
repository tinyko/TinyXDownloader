#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
source "$ROOT_DIR/scripts/common.sh"

CODESIGN_BIN="/usr/bin/codesign"
XCRUN_BIN="/usr/bin/xcrun"
DITTO_BIN="/usr/bin/ditto"
HDIUTIL_BIN="/usr/bin/hdiutil"

[[ -x "$CODESIGN_BIN" ]] || fail "Missing macOS system codesign at $CODESIGN_BIN"
[[ -x "$XCRUN_BIN" ]] || fail "Missing macOS system xcrun at $XCRUN_BIN"
[[ -x "$DITTO_BIN" ]] || fail "Missing macOS system ditto at $DITTO_BIN"
[[ -x "$HDIUTIL_BIN" ]] || fail "Missing macOS system hdiutil at $HDIUTIL_BIN"

if [[ "$(host_os)" != "darwin" ]]; then
  fail "./build-macos.sh must be run on macOS"
fi

APP_NAME="$(app_name)"
APP_VERSION="$(app_version)"
OUTPUT_NAME="$(app_output_name)"
APP_PATH="$ROOT_DIR/build/bin/${OUTPUT_NAME}.app"
RELEASE_DIR="$ROOT_DIR/build/release"
ZIP_PATH="$RELEASE_DIR/${APP_NAME}-v${APP_VERSION}-macos-arm64.zip"
DMG_PATH="$RELEASE_DIR/${APP_NAME}-v${APP_VERSION}-macos-arm64.dmg"

signing_enabled=false
if [[ -n "${MACOS_SIGN_IDENTITY:-}" || -n "${MACOS_TEAM_ID:-}" || -n "${MACOS_NOTARY_PROFILE:-}" ]]; then
  if [[ -z "${MACOS_SIGN_IDENTITY:-}" || -z "${MACOS_TEAM_ID:-}" || -z "${MACOS_NOTARY_PROFILE:-}" ]]; then
    fail "Provide MACOS_SIGN_IDENTITY, MACOS_TEAM_ID, and MACOS_NOTARY_PROFILE together to enable signing"
  fi
  signing_enabled=true
fi

bootstrap_project

log_step "Building ${APP_NAME} for ${MACOS_TARGET_PLATFORM}"
run_wails build -clean -platform "$MACOS_TARGET_PLATFORM" "$@"

[[ -d "$APP_PATH" ]] || fail "Expected app bundle was not generated: $APP_PATH"

mkdir -p "$RELEASE_DIR"
rm -f "$ZIP_PATH" "$DMG_PATH"

if [[ "$signing_enabled" == true ]]; then
  log_step "Signing app bundle with Developer ID"
  "$CODESIGN_BIN" \
    --force \
    --deep \
    --options runtime \
    --timestamp \
    --sign "$MACOS_SIGN_IDENTITY" \
    "$APP_PATH"

  submission_zip="$(mktemp "${TMPDIR:-/tmp}/${OUTPUT_NAME}-notary-XXXXXX.zip")"
  cleanup_submission_zip() {
    rm -f "$submission_zip"
  }
  trap cleanup_submission_zip EXIT

  log_step "Creating notarization submission archive"
  "$DITTO_BIN" -c -k --sequesterRsrc --keepParent "$APP_PATH" "$submission_zip"

  log_step "Submitting app for notarization"
  echo "Using Apple Team ID: $MACOS_TEAM_ID"
  "$XCRUN_BIN" notarytool submit "$submission_zip" \
    --keychain-profile "$MACOS_NOTARY_PROFILE" \
    --wait

  log_step "Stapling notarization ticket"
  "$XCRUN_BIN" stapler staple "$APP_PATH"
  "$XCRUN_BIN" stapler validate "$APP_PATH"
  trap - EXIT
  cleanup_submission_zip
else
  log_step "Applying ad-hoc signature for local distribution"
  "$CODESIGN_BIN" --force --deep --sign - "$APP_PATH"
fi

log_step "Verifying app signature"
"$CODESIGN_BIN" --verify --deep --strict "$APP_PATH"

log_step "Creating ZIP release archive"
"$DITTO_BIN" -c -k --sequesterRsrc --keepParent "$APP_PATH" "$ZIP_PATH"

log_step "Creating DMG release image"
dmg_staging_dir="$(mktemp -d "${TMPDIR:-/tmp}/${OUTPUT_NAME}-dmg-XXXXXX")"
cleanup_dmg_staging_dir() {
  rm -rf "$dmg_staging_dir"
}
trap cleanup_dmg_staging_dir EXIT

cp -R "$APP_PATH" "$dmg_staging_dir/"
ln -s /Applications "$dmg_staging_dir/Applications"
"$HDIUTIL_BIN" create \
  -volname "$APP_NAME" \
  -srcfolder "$dmg_staging_dir" \
  -ov \
  -format UDZO \
  "$DMG_PATH" >/dev/null

trap - EXIT
cleanup_dmg_staging_dir

log_step "Release artifacts ready"
printf 'App bundle: %s\n' "$APP_PATH"
printf 'ZIP archive: %s\n' "$ZIP_PATH"
printf 'DMG image: %s\n' "$DMG_PATH"
printf 'Bundle ID: %s\n' "$MACOS_BUNDLE_ID"
