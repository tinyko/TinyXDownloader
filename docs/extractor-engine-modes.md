# Extractor Engine Modes

`XDOWNLOADER_EXTRACTOR_ENGINE` controls which timeline extractor backend runs:

- `python`: always use the existing `gallery-dl` helper. This remains the production default.
- `go`: use the native Go extractor only. Unsupported requests return an extractor error instead of silently falling back.
- `auto`: try Go first only when the request matches the current Go support matrix, otherwise bypass directly to Python. If Go returns `ErrEngineFallbackRequired` or `ErrEngineUnsupported`, the request falls back to Python.

## Current Go support matrix

Phase 3B expands Go support to explicit-mode private likes and bookmarks while keeping production defaults conservative:

- Supported:
  - public `media` requests with `media_type=all|image|video|gif`
  - public `timeline`, `tweets`, and `with_replies`
  - `media_type=text` for public timeline requests
  - retweets include/skip for public timeline requests
  - `DateRangeRequest` with `media_filter=all|image|video|gif|text`
  - private `likes` requests with `media_type=all|image|video|gif|text` when `XDOWNLOADER_EXTRACTOR_ENGINE=go`
  - private `bookmarks` requests with `media_type=all|image|video|gif|text` when `XDOWNLOADER_EXTRACTOR_ENGINE=go`
- Not supported yet:
  - raw `search?q=` requests as a direct Go API
- `auto` mode still pins private `likes` and `bookmarks` to Python until private parity and live validation are complete

## Parity validation

The app exposes two parity methods for local verification:

- `CompareTimelineExtractorParity`
- `CompareDateRangeExtractorParity`

Use them to compare normalized `TwitterResponse` output between Python and Go. Public media golden fixtures live under [backend/testdata/x_public_media](/Users/tiny/DevecostudioProjects/Xdownloader/backend/testdata/x_public_media), public search golden fixtures live under [backend/testdata/x_public_search](/Users/tiny/DevecostudioProjects/Xdownloader/backend/testdata/x_public_search), private likes fixtures live under [backend/testdata/x_private_likes](/Users/tiny/DevecostudioProjects/Xdownloader/backend/testdata/x_private_likes), private bookmarks fixtures live under [backend/testdata/x_private_bookmarks](/Users/tiny/DevecostudioProjects/Xdownloader/backend/testdata/x_private_bookmarks), and timeline parser/strategy coverage lives in [backend/x_public_timeline_test.go](/Users/tiny/DevecostudioProjects/Xdownloader/backend/x_public_timeline_test.go).

## Diagnostics

Go public media requests emit `x_public_media_request`, Go timeline requests emit `x_public_timeline_request`, Go date-range search requests emit `x_public_search_request`, private likes requests emit `x_private_likes_request`, and private bookmarks requests emit `x_private_bookmarks_request`. The most important fields are:

- `fallback_code`: stable failure classification such as `missing_core_user`, `missing_cursor`, or `http_forbidden`
- `auth_mode`: `auth` or `guest`
- `cursor_present`: whether the page exposed a continuation cursor
- `page_item_count`: raw media entities seen on the page before dedupe/filtering
- `media_item_count`: final normalized media entries emitted to the app contract
- `text_item_count`: final normalized text entries emitted to the app contract when the request is text-only
- `viewer_ok`: whether the private likes path successfully resolved the authenticated account handle it is fetching against
- `partial_parse`: true when parsing failed after some items had already been consumed

These events are written to `backend.log` and are also included in support bundle exports. Extractor counters are available through the app method `GetExtractorMetricsSnapshot()`.

The Diagnostics drawer now includes an extractor section that shows:

- current engine mode
- private auto pinned status
- current Go support matrix summary
- extractor metrics
- validation runbook presets
- recent saved validation reports
- latest public/private readiness gates
- recent extractor events
- recent parity reports

Diagnostics parity uses the current single-account fetch context only. It can run:

- timeline parity for current public/private single-account fetch inputs
- date-range parity for current public single-account date-range inputs

Diagnostics also includes a rollout runbook workflow:

- `Add Current Context` captures the current parity-eligible single-account fetch setup into a saved validation preset
- presets are stored in app data as `extractor_runbook.json`
- `Run Validation` executes all enabled presets sequentially using the current public/private tokens, saves a structured report under `extractor_reports/`, and updates the public/private gate badges
- reports are token-free and intended for rollout review rather than runtime routing decisions

Diagnostics now also includes a public live validation workflow:

- `Run Live Validation` reuses the enabled runbook presets, but only public presets participate in promotion evidence
- each public case runs a real runtime fetch through the normal extractor entrypoint with a session-local candidate override, then immediately runs parity
- private presets remain in the runbook, but live sessions mark them `out_of_scope` and they do not contribute to promotion readiness
- live reports are stored in app data under `extractor_live_reports/`
- each live report computes three family-level views:
  - `parity`: the existing normalized-output gate
  - `live`: runtime fetch behavior, fallback, and cursor/completed semantics
  - `promotion`: `ready` only when both parity and live are ready for that public family
- live sessions are evidence only; they do not arm trials or change routing automatically

Diagnostics now also includes a public auto trial control plane:

- public rollout policy is stored in app data as `extractor_rollout_policy.json`
- public trials are armed manually per request family: `media`, `timeline`, and `date_range`
- only families whose gate is `ready` can be armed
- armed trials persist across app restarts until manually disarmed
- an armed family is only active while its current matching family gate remains `ready`
- if a family becomes non-ready after being armed, runtime falls back to Python and Diagnostics shows it as `armed but inactive`
- the Public Trial panel now also shows whether each family is `promotion ready` based on the latest matching live validation session

Support bundles now include:

- `backend.log`
- `extractor_diagnostics.json`
- `extractor_runbook.json`
- `extractor_rollout_policy.json`
- the latest saved validation reports under `extractor_reports/`
- the latest saved live validation reports under `extractor_live_reports/`

## Trial gate

Do not switch the default engine away from `python` until all of the following are true:

- public media and public search fixture tests are green
- golden parity responses are green
- live parity checks show no structural diffs for representative public media and date-range accounts
- `auto` mode fallback preserves existing cursor and snapshot semantics
