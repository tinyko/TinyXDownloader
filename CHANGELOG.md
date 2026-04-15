# Changelog

## V1.3.2 - 2026-04-15

- fixed default-route soak and `phase7_ready` semantics so only real default Go traffic contributes to depythonization evidence
- reduced diagnostics snapshot read amplification with cached validation/live summaries and throttled soak-state flushing instead of rewriting the full soak file on every request
- fixed the unified batch download progress race so `go test ./...` passes reliably again in GitHub CI

## V1.3.1 - 2026-04-15

- fixed diagnostics support-matrix serialization so go-only snapshots and legacy bundles no longer crash the page when optional arrays are absent
- simplified the diagnostics drawer into a tighter support-and-health layout with clearer soak rows, lighter evidence summaries, and dedicated maintenance actions
- restored diagnostics drawer scrolling and rebuilt the macOS release artifacts for the updated go-only support experience

## V1.3.0 - 2026-04-15

- cut the extractor runtime over to Go-only for public media, public timeline, public date-range, private likes, and private bookmarks
- retired Python/gallery-dl parity and rollout controls into historical audit evidence while keeping diagnostics, support bundles, and soak state readable
- removed Python/helper/venv build dependencies from normal development, CI, and macOS packaging paths

## V1.2.3 - 2026-04-15

- hardened macOS release packaging with checksum output, stricter signing/notarization validation hooks, and release-ready artifacts
- added self-hosted desktop smoke automation for the real Wails app, plus GitHub workflows for `desktop-smoke` and tag-based releases
- introduced unified app data directory overrides, persistent diagnostics logging, support bundle export, database backup/restore, and diagnostics actions in the desktop UI

## V1.2.2 - 2026-04-14

- added seeded Playwright smoke coverage for Saved Accounts, fetch, download, integrity, and the unified activity panel lifecycle states
- upgraded the frontend toolchain to Vite 8 and refreshed direct frontend dependencies to current latest versions
- tightened lint quality gates to fail on warnings and fixed the TypeScript 6 / ESLint 10 issues exposed by the toolchain upgrade

## V1.2.1 - 2026-04-14

- refactored the Wails bridge into focused app entrypoints for accounts, downloads, extraction, integrity, and tools
- shipped Saved Accounts bootstrap, filtered query pagination, matching-id lookup, and ID-based account hydration for the database workspace
- added background Download Integrity task flow with quick/deep modes, progress polling, cancellation, and report display in Settings
- tightened frontend lint coverage by excluding generated `wailsjs` output and fixing React/compiler, typing, and state-management issues across the workspace
