# Extractor Runtime

The extractor system is now a **Go-only runtime**.

All five supported user-visible families are handled by the native Go extractor:

- public `media`
- public `timeline`, `tweets`, and `with_replies`
- public `date_range`
- private `likes`
- private `bookmarks`

Raw `search?q=` is still not a direct user-facing Go API and is not part of the runtime support contract.

## Engine env compatibility

`XDOWNLOADER_EXTRACTOR_ENGINE` is still accepted for compatibility, but runtime behavior has been cut over:

- `go`: Go-only runtime
- `auto`: Go-only runtime
- `python`: deprecated alias that logs a warning and still runs the Go-only runtime
- unset: Go-only runtime

There is no Python fallback, no helper discovery, and no gallery-dl execution path in the current app version.

## Diagnostics

Diagnostics is now an **audit surface**, not a rollout control plane.

The extractor panel shows:

- current runtime mode
- `go_only_runtime`
- current soak status
- default-route status for each family
- historical validation, live-validation, rollout, and baseline evidence
- `phase7_ready` / cutover audit state

The old control-plane actions are retired:

- ad hoc parity
- saved runbook edits
- validation runs
- live validation runs
- public/private trial toggles
- public/private promotion toggles

Historical evidence is still visible so support bundles can answer:

- when the cutover happened
- which frozen baselines were approved
- what validation/live evidence existed before cutover
- whether the current release remains healthy

## Support bundles

Support bundles continue to include the historical extractor audit chain:

- `extractor_diagnostics.json`
- `extractor_rollout_policy.json`
- saved validation reports
- saved live validation reports
- `extractor_soak_state.json`
- `extractor_soak_events.json`

These artifacts remain token-free and are kept for audit, incident review, and cutover traceability.

## Development and build

The project no longer requires Python for normal development, CI, packaging, or runtime.

Current expectations:

- `./bootstrap.sh`, `./dev.sh`, and `./build.sh` are go-only
- CI is go-only
- release packaging is go-only
- there is no `INCLUDE_PYTHON_FALLBACK` split anymore

## Historical notes

Earlier phases introduced parity, validation runbooks, live validation sessions, public/private trials, promotion baselines, and soak gating. Those artifacts remain in app data and support bundles, but they no longer drive runtime routing in the current version.
