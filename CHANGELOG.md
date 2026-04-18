# Changelog

## V1.3.17 - 2026-04-18

- preserved per-item download failure samples when global download history merges terminal summaries
- reduced image-download concurrency and raised retry attempts to lower transient `pbs.twimg.com` connection-reset failures in large batches
- added regression coverage for connection-reset retry classification and persisted failure details

## V1.3.16 - 2026-04-18

- hid duplicate count-only download messages so result summaries are shown once in Activity and Task History
- returned per-item download failure samples from the backend, including tweet id, URL, and the underlying download error
- displayed failure samples in the download task summary so failed items can be diagnosed without guessing from aggregate counts

## V1.3.15 - 2026-04-18

- fixed download task history so failed/completed sessions are recorded even when the final backend idle event is missed
- surfaced download result summaries in Activity and Task History, including downloaded, skipped, failed counts, and backend messages
- hid the download cancel action after terminal states and treated all-failed bulk download responses as failed tasks

## V1.3.14 - 2026-04-17

- added a GitHub API tarball checkout fallback for self-hosted macOS jobs when git transport keeps resetting
- relaxed release checkout verification so tarball fallback workspaces do not require local git tag metadata

## V1.3.13 - 2026-04-17

- retried manual `git fetch` checkout steps on self-hosted macOS jobs so transient GitHub HTTPS resets do not fail desktop smoke or release jobs

## V1.3.12 - 2026-04-17

- removed third-party action downloads from self-hosted macOS CI/release jobs by using local `git` checkout and `gh` release commands
- kept desktop smoke artifacts archived locally in the runner workspace so GitHub action download failures no longer block smoke validation
- bounded Developer ID signing and notarization waits so stalled Apple timestamp/notary requests can retry instead of hanging the release build

## V1.3.11 - 2026-04-17

- made desktop smoke verification robust when the virtualized saved-account list does not render rows in self-hosted macOS runner sessions
- added retry handling around Wails CLI invocations to absorb transient Go module proxy TLS/network failures during local and CI builds

## V1.3.10 - 2026-04-17

- retried transient X network request failures in the native client so lookup/fetch timeouts do not immediately mark saved accounts incomplete
- treated generic `x api request failed` timeline errors as retryable in the frontend fetch loop
- retried transient Developer ID timestamp and Apple notarization upload failures during local and release macOS packaging
- verified `@sakami22` and `@silvergirlsEC` can fetch again after the retry hardening

## V1.3.9 - 2026-04-16

- retried temporary X GraphQL timeline envelope errors so media fetches like `@wasaby_fun01` do not stop after a recoverable tail-page error
- added frontend regression coverage for media, timeline, and search timeline envelope error retry classification

## V1.3.8 - 2026-04-16

- retried transient X API server errors (`502`, `503`, and `504`) in the native extractor so temporary upstream outages do not immediately fail account fetches
- classified temporary X server outages as retryable in the frontend fetch loop, including the `@silvergirlsEC` 503 case
- added backend and frontend regression coverage for transient X server-error handling

## V1.3.7 - 2026-04-16

- fixed public media fetches that could stall after X returned consecutive empty cursor pages by completing the fetch after a bounded empty-tail window
- added regression coverage for the `Awake_Kamuy`-style empty cursor tail so future fetch-loop changes do not reintroduce the hang
- pinned the latest `pnpm` version across local package metadata and CI so Node tooling stays consistent between local builds and GitHub Actions

## V1.3.6 - 2026-04-16

- simplified Support & Health so it only shows current extractor support and local maintenance actions instead of retired rollout, soak, phase, and fallback noise
- hardened the macOS release workflow for the self-hosted runner by using the installed Go toolchain directly and checking out the exact release tag for manual dispatches

## V1.3.5 - 2026-04-16

- fixed macOS DMG packaging to preserve stapled notarization tickets by copying the app bundle with `ditto`
- rebuilt the signed macOS release artifacts after verifying both ZIP and DMG contents pass Gatekeeper as notarized Developer ID apps

## V1.3.4 - 2026-04-16

- taught public media, public timeline, and public date-range fetches to reuse the saved public auth token automatically when a request omits an explicit token
- only require manual auth token entry for private fetches, while surfacing clearer guidance when a public account still needs authenticated public access
- added coverage for stored public token resolution so the new public-auth fallback path stays stable across future extractor changes

## V1.3.3 - 2026-04-16

- reworked native X rate-limit handling to follow gallery-dl-style cooldowns driven by `x-rate-limit-reset`, low-budget preemption, and bounded backend retries instead of guessed frontend throttling
- fixed final unified download progress reporting so concurrent batch downloads always emit the expected terminal progress update
- rebuilt the release artifacts on top of the stabilized go-only runtime and bounded task history workspace

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
