# gallery-dl Twitter/X Research

## Goal

This note focuses on the `gallery-dl` subset that TinyXDownloader actually uses today and maps that subset onto the current Go backend.

It answers two questions:

1. Which `gallery-dl` modules and code paths matter for this project?
2. Which parts can be replaced directly with Go, and which parts should keep a compatibility fallback in early versions?

## Current Project Integration

TinyXDownloader does not embed Python logic into Go directly. The current flow is:

1. Go builds request specs and launches the local `extractor` helper binary.
2. The helper wraps `gallery-dl`'s Twitter extractor.
3. The helper converts `gallery-dl`'s message stream into project JSON.
4. Go normalizes that JSON into `TwitterResponse`.
5. Frontend persists cursor/snapshot state and drives incremental fetch loops.

Relevant project files:

- `helper/twitter_cli.py`
- `helper/twitter_common.py`
- `backend/twitter_extract.go`
- `backend/twitter_flow.go`
- `backend/twitter_types.go`
- `frontend/src/lib/fetch/runTimelineFetchLoop.ts`

## Part 1: gallery-dl Twitter Subset Module Map

### High-level call graph

The project's helper path is:

1. `helper/twitter_cli.py`
2. `helper/twitter_common.py:run_request()`
3. `gallery_dl.extractor.find(url)`
4. `gallery_dl.extractor.twitter.*Extractor`
5. `TwitterExtractor.items()`
6. `TwitterAPI.*()` and `_pagination_tweets()`
7. `gallery-dl` yields `Message.Directory` and `Message.Url`
8. `helper/twitter_common.py` converts those messages into `media[]` and `metadata[]`

### Modules that actually matter

#### 1. Message protocol layer

File:

- `gallery_dl/extractor/message.py`

Why it matters:

- `gallery-dl` extractors do not return a project-specific JSON model.
- They emit message tuples like `Message.Directory` and `Message.Url`.
- TinyXDownloader's helper only consumes a small subset of this protocol.

Project impact:

- This layer does not need to exist in a pure Go rewrite.
- It is only a transport shape inside `gallery-dl`.

#### 2. Extractor base class

File:

- `gallery_dl/extractor/common.py`

Why it matters:

- Provides `Extractor.request()`, retry behavior, cookie handling, and config lookup.
- All Twitter extractor behavior inherits from here.

Project impact:

- A Go rewrite needs equivalents for:
  - request/retry behavior
  - cookie loading and mutation
  - rate-limit waits
  - auth-required vs abort-style error classification

It does not need to recreate the full generic extractor framework.

#### 3. Twitter extractor family

File:

- `gallery_dl/extractor/twitter.py`

This is the core implementation.

Important parts:

- `TwitterExtractor.items()`
  - orchestrates login, API setup, tweet iteration, filtering, and message emission
- `TwitterTimelineExtractor`
  - special three-stage timeline strategy
- `TwitterMediaExtractor`
  - user media timeline
- `TwitterLikesExtractor`
  - likes timeline
- `TwitterBookmarkExtractor`
  - bookmarks timeline
- `TwitterSearchExtractor`
  - search-based extraction, which is what the project uses for date-range fetches
- `TwitterAPI`
  - X internal API and GraphQL client

#### 4. Transaction ID generator

File:

- `gallery_dl/transaction_id.py`

Why it matters:

- It generates `x-client-transaction-id`.
- It scrapes the X homepage and an `ondemand.s.*.js` asset to derive keys.
- This is one of the most brittle and platform-specific parts of the stack.

Project impact:

- This is a major risk area for a pure Go implementation.
- It is a strong candidate for "keep Python fallback until Go version is proven".

### Project-relevant extractor modes

TinyXDownloader only depends on a narrow Twitter/X subset:

- `media`
- `timeline`
- `likes`
- `bookmarks`
- `search` for date-range fetches
- `text-tweets`
- retweet include/skip behavior
- cursor-based continuation

It does not currently depend on many other `gallery-dl` Twitter features such as:

- followers/following extraction
- list members
- home timeline
- notifications
- avatar/background extractors
- external queue chaining

### Endpoint and behavior mapping

These are the important `gallery-dl` Twitter API methods for this project:

- `TwitterAPI.user_media(screen_name)`
  - used for public media-focused fetches
- `TwitterAPI.user_tweets(screen_name)`
  - used when text tweets or retweets are requested
- `TwitterAPI.user_likes(screen_name)`
  - used for likes
- `TwitterAPI.user_bookmarks()`
  - used for bookmarks
- `TwitterAPI.search_timeline(query, product)`
  - used for search and date-range style fetches
- `TwitterAPI._pagination_tweets(...)`
  - parses timeline instruction payloads and extracts tweets plus continuation cursor
- `TwitterAPI._call(...)`
  - attaches auth headers, guest token, csrf token, transaction id, retries, and rate-limit handling

### The most important behavior: timeline strategy

`TwitterTimelineExtractor` is more complex than a simple "hit one endpoint until cursor ends" flow.

It can do a staged strategy:

1. fetch user timeline/media directly
2. build a search query like `from:user max_id:...`
3. search with `filter:links`
4. optionally search again without the media-only filter

This matters because:

- it explains why `gallery-dl` can recover tweets a simpler API client might miss
- a naive Go port that only calls `UserMedia` will likely under-fetch some timelines

### The most important behavior: auth and guest mode

`TwitterAPI._call()` does more than "add bearer token":

- uses a static bearer token
- reads or creates `ct0`
- sets `x-csrf-token`
- detects whether `auth_token` exists
- chooses between authenticated mode and guest mode
- requests a guest token from `/1.1/guest/activate.json`
- optionally generates `x-client-transaction-id`
- retries on some API errors
- may fall back from auth mode to guest mode in some blocked cases

This is the single hardest area to replace cleanly.

## Minimal Output Contract TinyXDownloader Actually Uses

The project does not need all raw `gallery-dl` tweet data.

The effective output contract is small.

### Account-level fields used downstream

Needed by `AccountInfo`:

- `name`
- `nick`
- `date`
- `followers_count`
- `friends_count`
- `profile_image`
- `statuses_count`

### Timeline/media-level fields used downstream

Needed by `TimelineEntry`:

- `url`
- `date`
- `tweet_id`
- `type`
- `extension`
- `width`
- `height`
- `content`
- `view_count`
- `bookmark_count`
- `favorite_count`
- `retweet_count`
- `reply_count`
- `source`
- `author_username`
- `original_filename`

### Download-level minimum

Needed by `MediaItem` and saved downloads:

- `url`
- `date`
- `tweet_id`
- `type`
- `username` or equivalent author/source username
- `content`
- `original_filename`

This is good news for a Go rewrite because the required domain model is much smaller than raw `gallery-dl` tweet payloads.

## Part 2: Mapping to the Current Go Backend

### Current Go-owned layers

These areas are already project-owned and do not depend on Python logic:

- request spec assembly in `backend/twitter_flow.go`
- URL construction in `backend/twitter_urls.go`
- extractor process orchestration in `backend/twitter_execute.go`
- extractor worker pool in `backend/twitter_worker.go` and `backend/twitter_pool.go`
- response normalization in `backend/twitter_convert.go`
- structured snapshot persistence in `backend/snapshot_store_write.go`
- saved timeline and download payload loading from SQLite
- download execution and file naming
- frontend incremental fetch loop and cursor/snapshot bookkeeping

In other words, the current Python dependency is concentrated in extraction, not in the rest of the app.

### Directly replaceable with Go

These parts can be replaced directly without changing the user-facing product model:

#### 1. Extractor process boundary

Today:

- Go talks to a helper binary.

Replace path:

- Define a Go `ExtractorEngine` interface and let the current Python helper be one implementation.
- Add a second implementation for native Go extraction.

Good seam candidates:

- `ExtractTimeline`
- `ExtractDateRange`
- `executeExtractorSpec`

#### 2. Request spec building

Today:

- `backend/twitter_flow.go` already turns app intent into an extractor request.

Replace path:

- Keep the same Go-side request spec shape and point it to a native Go engine.

#### 3. Response normalization

Today:

- Go converts helper JSON into `TwitterResponse`.

Replace path:

- Keep `TwitterResponse`, `TimelineEntry`, and `AccountInfo` unchanged.
- Only swap the data source from helper JSON to native structs.

#### 4. Storage and download pipeline

Today:

- snapshots, timeline pages, download media index, and downloader all live in Go.

Replace path:

- no architectural rewrite required
- native Go extractor can feed the same persistence path

### Must keep compatibility fallback in early Go versions

These are the risky areas where a pure Go version should not be the only path at first.

#### 1. `x-client-transaction-id`

Why risky:

- it depends on parsing X homepage markup and asset code
- it can break when X changes frontend assets

Recommendation:

- keep Python `gallery-dl` fallback until native Go transaction-id generation is stable across real accounts

#### 2. Guest/auth mode negotiation

Why risky:

- current project stores only `auth_token`
- native implementation may need more explicit `ct0` and guest-token handling
- likes/bookmarks/private timelines are more sensitive to auth semantics

Recommendation:

- first Go version should support public guest/public auth fetches
- keep likes/bookmarks on Python fallback until auth behavior is validated

#### 3. Timeline instruction parsing

Why risky:

- GraphQL timeline payloads use nested instruction arrays with multiple entry shapes
- `gallery-dl` already handles tombstones, missing `core`, quoted tweets, retweets, ads, and cursor extraction

Recommendation:

- first Go version should target the exact subset needed for:
  - `UserMedia`
  - `UserTweets`
  - `SearchTimeline`
- use Python fallback when payload shape is unknown or incomplete

#### 4. Timeline recovery strategy

Why risky:

- `TwitterTimelineExtractor` uses staged fallback behavior, not one endpoint
- if Go only ports `UserMedia`, fetch completeness may regress

Recommendation:

- preserve staged strategy for `timeline`
- if strategy stage fails, fall back to Python instead of silently returning fewer items

#### 5. Rate-limit and anti-bot drift

Why risky:

- the Python implementation already includes wait/retry/rate-limit logic
- X often changes behavior without warning

Recommendation:

- native Go path should have telemetry and a fallback threshold, not a hard cutover

## Recommended Replacement Boundary

The most practical boundary is:

- keep app-facing types unchanged
- replace only the extraction engine

Suggested interface shape:

```go
type ExtractorEngine interface {
    ExtractTimeline(ctx context.Context, req TimelineRequest) (*TwitterResponse, error)
    ExtractDateRange(ctx context.Context, req DateRangeRequest) (*TwitterResponse, error)
}
```

Suggested implementations:

- `PythonGalleryDLExtractor`
- `GoTwitterExtractor`

This gives the project:

- low-risk rollout
- feature-by-feature migration
- direct A/B comparison on identical request specs

## Suggested Delivery Phases

### Phase 0: interface and dual-engine plumbing

Do this first:

- extract the current Python helper path behind an interface
- add logging and counters for engine choice, fallback count, and failure reason

### Phase 1: native Go public media fetch

Target:

- `media`
- public accounts
- cursor pagination
- output parity with current `TimelineEntry`

Fallback:

- use Python engine on any parse/auth mismatch

### Phase 2: native Go public timeline/search

Target:

- `timeline`
- date-range search
- retweet include/skip
- text tweets

Fallback:

- keep Python engine for any staged search/timeline mismatch

### Phase 3: native Go private fetches

Target:

- `likes`
- `bookmarks`

This is the phase with the highest auth and compatibility risk.

### Phase 4: remove Python from the critical path

Only after:

- fallback count is consistently low
- native output matches saved snapshot expectations
- real-world accounts confirm stability across guest/auth/private modes

## Bottom Line

### The good news

- TinyXDownloader already has a strong architectural seam for replacing `gallery-dl`.
- Most of the app is already Go-owned.
- The actual output contract needed by the app is much smaller than raw `gallery-dl` internals.

### The hard parts

- transaction-id generation
- guest/auth negotiation
- GraphQL timeline instruction parsing
- staged timeline/search fallback behavior

### Practical conclusion

For this project, "replace `gallery-dl`" should mean:

- keep the current Go app model
- replace only the Twitter extraction engine
- ship a dual-engine system first
- migrate public media, then public timeline/search, then private modes

That path is much safer than trying to fully replicate `gallery-dl` end-to-end in one shot.
