package backend

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"testing"
	"time"
)

func TestGoTwitterEngineTimelineSupportPhase3B(t *testing.T) {
	engine := &GoTwitterEngine{}

	tests := []struct {
		name   string
		req    TimelineRequest
		ok     bool
		reason string
	}{
		{
			name: "public media all",
			req: TimelineRequest{
				Username:  "example",
				MediaType: "all",
			},
			ok: true,
		},
		{
			name: "public media image",
			req: TimelineRequest{
				Username:  "example",
				MediaType: "image",
			},
			ok: true,
		},
		{
			name: "public media video",
			req: TimelineRequest{
				Username:  "example",
				MediaType: "video",
			},
			ok: true,
		},
		{
			name: "public media gif",
			req: TimelineRequest{
				Username:  "example",
				MediaType: "gif",
			},
			ok: true,
		},
		{
			name: "text only supported",
			req: TimelineRequest{
				Username:  "example",
				MediaType: "text",
			},
			ok: true,
		},
		{
			name: "timeline supported",
			req: TimelineRequest{
				Username:     "example",
				TimelineType: "timeline",
				MediaType:    "all",
			},
			ok: true,
		},
		{
			name: "retweets supported",
			req: TimelineRequest{
				Username:  "example",
				Retweets:  true,
				MediaType: "all",
			},
			ok: true,
		},
		{
			name: "with replies supported",
			req: TimelineRequest{
				Username:     "example",
				TimelineType: "with_replies",
				MediaType:    "all",
			},
			ok: true,
		},
		{
			name: "likes supported",
			req: TimelineRequest{
				Username:     "example",
				TimelineType: "likes",
				MediaType:    "all",
			},
			ok: true,
		},
		{
			name: "bookmarks supported",
			req: TimelineRequest{
				TimelineType: "bookmarks",
				MediaType:    "all",
			},
			ok: true,
		},
		{
			name: "date-range remains unsupported through timeline selector",
			req: TimelineRequest{
				Username:     "example",
				TimelineType: "search",
				MediaType:    "all",
			},
			reason: "phase 2",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			ok, reason := engine.TimelineSupport(tt.req)
			if ok != tt.ok {
				t.Fatalf("expected ok=%t, got %t (reason=%q)", tt.ok, ok, reason)
			}
			if tt.reason != "" && !containsInsensitive(reason, tt.reason) {
				t.Fatalf("expected reason to contain %q, got %q", tt.reason, reason)
			}
		})
	}
}

func TestParseXMediaTimelinePageParsesFirstPageAndFilters(t *testing.T) {
	envelope := decodeUserMediaEnvelope(t, fixtureFirstPagePayload(t))

	page, err := parseXMediaTimelinePage(envelope, "all")
	if err != nil {
		t.Fatalf("parseXMediaTimelinePage returned error: %v", err)
	}
	if page.RawItemCount != 4 {
		t.Fatalf("expected raw item count 4, got %d", page.RawItemCount)
	}
	if len(page.Items) != 3 {
		t.Fatalf("expected 3 deduplicated media items, got %d", len(page.Items))
	}
	if page.Cursor != "cursor-1" {
		t.Fatalf("expected cursor-1, got %q", page.Cursor)
	}
	if page.Items[0].Type != "photo" || page.Items[1].Type != "video" || page.Items[2].Type != "animated_gif" {
		t.Fatalf("unexpected item types: %#v", []string{page.Items[0].Type, page.Items[1].Type, page.Items[2].Type})
	}
	if page.Items[1].Bitrate != 2176000 {
		t.Fatalf("expected highest bitrate variant, got %d", page.Items[1].Bitrate)
	}
	if page.Items[0].Source != "Sprinklr" {
		t.Fatalf("expected source normalization, got %q", page.Items[0].Source)
	}
	if page.Items[0].Author.Name != "example_user" || page.Items[0].Author.Nick != "Example Display" {
		t.Fatalf("unexpected author mapping: %#v", page.Items[0].Author)
	}
	if page.Items[0].User.ProfileImage != "https://pbs.twimg.com/profile_images/example/avatar.jpg" {
		t.Fatalf("expected normalized profile image, got %q", page.Items[0].User.ProfileImage)
	}

	imagePage, err := parseXMediaTimelinePage(envelope, "image")
	if err != nil {
		t.Fatalf("image filter returned error: %v", err)
	}
	if len(imagePage.Items) != 1 || imagePage.Items[0].Type != "photo" {
		t.Fatalf("unexpected image filter result: %#v", imagePage.Items)
	}

	videoPage, err := parseXMediaTimelinePage(envelope, "video")
	if err != nil {
		t.Fatalf("video filter returned error: %v", err)
	}
	if len(videoPage.Items) != 1 || videoPage.Items[0].Type != "video" {
		t.Fatalf("unexpected video filter result: %#v", videoPage.Items)
	}

	gifPage, err := parseXMediaTimelinePage(envelope, "gif")
	if err != nil {
		t.Fatalf("gif filter returned error: %v", err)
	}
	if len(gifPage.Items) != 1 || gifPage.Items[0].Type != "animated_gif" {
		t.Fatalf("unexpected gif filter result: %#v", gifPage.Items)
	}
}

func TestParseXMediaTimelinePageParsesContinuationModule(t *testing.T) {
	envelope := decodeUserMediaEnvelope(t, fixtureContinuationPayload(t))

	page, err := parseXMediaTimelinePage(envelope, "all")
	if err != nil {
		t.Fatalf("parseXMediaTimelinePage returned error: %v", err)
	}
	if page.RawItemCount != 1 {
		t.Fatalf("expected raw item count 1, got %d", page.RawItemCount)
	}
	if len(page.Items) != 1 {
		t.Fatalf("expected 1 item, got %d", len(page.Items))
	}
	if page.Cursor != "cursor-2" {
		t.Fatalf("expected cursor-2, got %q", page.Cursor)
	}
	if page.Items[0].TweetID != TweetIDString(9002) {
		t.Fatalf("unexpected tweet id: %v", page.Items[0].TweetID)
	}
}

func TestBuildPublicMediaTimelineResponseMapsCurrentContract(t *testing.T) {
	response, err := buildPublicMediaTimelineResponse(
		TimelineRequest{
			Username:  "example_user",
			BatchSize: 20,
			Page:      1,
			MediaType: "all",
		},
		fixtureXUser(),
		decodeUserMediaEnvelope(t, fixtureFirstPagePayload(t)),
	)
	if err != nil {
		t.Fatalf("buildPublicMediaTimelineResponse returned error: %v", err)
	}

	if response.AccountInfo.Name != "example_user" {
		t.Fatalf("expected account name to be username, got %q", response.AccountInfo.Name)
	}
	if response.AccountInfo.Nick != "Example Display" {
		t.Fatalf("expected display name, got %q", response.AccountInfo.Nick)
	}
	if response.AccountInfo.ProfileImage != "https://pbs.twimg.com/profile_images/example/avatar.jpg" {
		t.Fatalf("unexpected profile image: %q", response.AccountInfo.ProfileImage)
	}
	if response.AccountInfo.FollowersCount != 1200 || response.AccountInfo.StatusesCount != 77 {
		t.Fatalf("unexpected account counts: %#v", response.AccountInfo)
	}
	if response.Completed {
		t.Fatal("expected first page with cursor to be incomplete")
	}
	if response.Cursor != "cursor-1" || !response.Metadata.HasMore {
		t.Fatalf("unexpected cursor metadata: %#v", response.Metadata)
	}
	if len(response.Timeline) != 3 {
		t.Fatalf("expected 3 timeline entries, got %d", len(response.Timeline))
	}
	if response.Timeline[1].Type != "video" {
		t.Fatalf("expected video entry type, got %q", response.Timeline[1].Type)
	}
	if response.Timeline[2].Type != "animated_gif" {
		t.Fatalf("expected animated_gif entry type, got %q", response.Timeline[2].Type)
	}
}

func TestParseXMediaTimelinePageMissingCoreReturnsFallback(t *testing.T) {
	payload := fixtureFirstPagePayload(t)
	entries := payload["data"].(map[string]any)["user"].(map[string]any)["result"].(map[string]any)["timeline"].(map[string]any)["timeline"].(map[string]any)["instructions"].([]any)[0].(map[string]any)["entries"].([]any)
	moduleItems := entries[0].(map[string]any)["content"].(map[string]any)["items"].([]any)
	tweetResult := moduleItems[0].(map[string]any)["item"].(map[string]any)["itemContent"].(map[string]any)["tweet_results"].(map[string]any)["result"].(map[string]any)
	delete(tweetResult, "core")

	_, err := parseXMediaTimelinePage(decodeUserMediaEnvelope(t, payload), "all")
	if err == nil {
		t.Fatal("expected missing core to trigger fallback")
	}
	if !errors.Is(err, ErrEngineFallbackRequired) {
		t.Fatalf("expected fallback required error, got %v", err)
	}
}

func TestBuildPublicMediaTimelineResponseMissingCursorReturnsFallback(t *testing.T) {
	payload := fixtureFirstPagePayload(t)
	entries := payload["data"].(map[string]any)["user"].(map[string]any)["result"].(map[string]any)["timeline"].(map[string]any)["timeline"].(map[string]any)["instructions"].([]any)[0].(map[string]any)["entries"].([]any)
	payload["data"].(map[string]any)["user"].(map[string]any)["result"].(map[string]any)["timeline"].(map[string]any)["timeline"].(map[string]any)["instructions"].([]any)[0].(map[string]any)["entries"] = entries[:2]

	_, err := buildPublicMediaTimelineResponse(
		TimelineRequest{Username: "example_user", BatchSize: 20, Page: 1, MediaType: "all"},
		fixtureXUser(),
		decodeUserMediaEnvelope(t, payload),
	)
	if err == nil {
		t.Fatal("expected missing cursor to trigger fallback")
	}
	if !errors.Is(err, ErrEngineFallbackRequired) {
		t.Fatalf("expected fallback required error, got %v", err)
	}
	metadata, ok := xFallbackDetails(err)
	if !ok {
		t.Fatal("expected fallback metadata")
	}
	if metadata.Stage != "normalize" || metadata.Code != "missing_cursor" {
		t.Fatalf("unexpected fallback metadata: %+v", metadata)
	}
}

func TestXSessionClassifyHTTPErrorTreatsStatusAsFallback(t *testing.T) {
	session := &xAPISession{
		owner:     &xAPIClient{},
		authToken: "",
	}

	tests := []struct {
		name       string
		stage      string
		statusCode int
		endpoint   string
		body       []byte
		code       string
	}{
		{name: "guest activate unauthorized", stage: "lookup", statusCode: 401, endpoint: xGuestActivatePath, code: "http_unauthorized"},
		{name: "lookup unauthorized", stage: "lookup", statusCode: 401, endpoint: xUserByScreenNamePath, code: "http_unauthorized"},
		{name: "forbidden", stage: "fetch", statusCode: 403, endpoint: xUserMediaPath, code: "http_forbidden"},
		{name: "guest not found", stage: "fetch", statusCode: 404, endpoint: xUserMediaPath, code: "http_not_found"},
		{name: "rate limited", stage: "fetch", statusCode: 429, endpoint: xUserMediaPath, code: "http_rate_limited"},
		{name: "server error", stage: "fetch", statusCode: 500, endpoint: xUserMediaPath, body: []byte(`{"errors":[{"message":"boom"}]}`), code: "http_status"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := session.classifyHTTPError(tt.stage, tt.statusCode, tt.endpoint, tt.body, nil)
			if err == nil {
				t.Fatal("expected an error")
			}
			if !errors.Is(err, ErrEngineFallbackRequired) {
				t.Fatalf("expected fallback required, got %v", err)
			}
			metadata, ok := xFallbackDetails(err)
			if !ok {
				t.Fatal("expected fallback metadata")
			}
			if metadata.Stage != tt.stage || metadata.Code != tt.code {
				t.Fatalf("unexpected fallback metadata: %+v", metadata)
			}
		})
	}
}

func TestXSessionClassifyHTTPErrorRateLimitedIncludesRetryAfter(t *testing.T) {
	session := &xAPISession{
		owner: &xAPIClient{
			now: time.Now,
		},
	}

	headers := http.Header{}
	headers.Set("Retry-After", "7")

	err := session.classifyHTTPError("fetch", http.StatusTooManyRequests, xUserMediaPath, nil, headers)
	if err == nil {
		t.Fatal("expected rate limit error")
	}
	if !strings.Contains(err.Error(), "retry after 8s") {
		t.Fatalf("expected retry-after hint, got %q", err.Error())
	}
	metadata, ok := xFallbackDetails(err)
	if !ok {
		t.Fatal("expected fallback metadata")
	}
	if metadata.Code != "http_rate_limited" {
		t.Fatalf("unexpected fallback code: %+v", metadata)
	}
}

func TestXResolvePublicAuthTokenUsesStoredTokenWhenRequestTokenMissing(t *testing.T) {
	t.Setenv(AppDataDirEnv, t.TempDir())
	if err := SaveStoredAuthTokens(StoredAuthTokens{
		PublicToken:  "stored-public-token",
		PrivateToken: "private-token",
	}); err != nil {
		t.Fatalf("save stored auth tokens: %v", err)
	}

	resolution := xResolvePublicAuthToken("")
	if resolution.Token != "stored-public-token" {
		t.Fatalf("expected stored public token, got %q", resolution.Token)
	}
	if resolution.Mode != "stored-auth" {
		t.Fatalf("expected stored-auth mode, got %q", resolution.Mode)
	}
}

func TestXResolvePublicAuthTokenPrefersExplicitToken(t *testing.T) {
	t.Setenv(AppDataDirEnv, t.TempDir())
	if err := SaveStoredAuthTokens(StoredAuthTokens{
		PublicToken: "stored-public-token",
	}); err != nil {
		t.Fatalf("save stored auth tokens: %v", err)
	}

	resolution := xResolvePublicAuthToken("explicit-token")
	if resolution.Token != "explicit-token" {
		t.Fatalf("expected explicit token, got %q", resolution.Token)
	}
	if resolution.Mode != "auth" {
		t.Fatalf("expected auth mode, got %q", resolution.Mode)
	}
}

func TestXAPISessionDoJSONRetriesRateLimitUntilSuccess(t *testing.T) {
	fakeNow := time.Unix(1_700_000_000, 0)
	var sleeps []time.Duration
	attempts := 0
	session := newXAPITestSession(t, func(w http.ResponseWriter, r *http.Request) {
		attempts++
		if attempts == 1 {
			w.Header().Set("x-rate-limit-reset", strconv.FormatInt(fakeNow.Add(3*time.Second).Unix(), 10))
			http.Error(w, "too many requests", http.StatusTooManyRequests)
			return
		}
		writeJSONResponse(t, w, map[string]any{"ok": true})
	})
	session.owner = &xAPIClient{
		now: func() time.Time { return fakeNow },
		sleep: func(_ context.Context, delay time.Duration) error {
			sleeps = append(sleeps, delay)
			fakeNow = fakeNow.Add(delay)
			return nil
		},
		rateLimitDelay: xRateLimitCooldown,
		retryCount:     4,
		rateLimitRoll:  func() int { return 5 },
	}

	var payload map[string]any
	if err := session.doJSON(context.Background(), "fetch", http.MethodGet, xAPIRootURL, xUserMediaPath, nil, true, &payload); err != nil {
		t.Fatalf("doJSON returned error: %v", err)
	}
	if attempts != 2 {
		t.Fatalf("expected 2 attempts, got %d", attempts)
	}
	if len(sleeps) != 1 || sleeps[0] != 4*time.Second {
		t.Fatalf("expected one 4s rate-limit wait, got %v", sleeps)
	}
	if got := payload["ok"]; got != true {
		t.Fatalf("expected successful payload, got %#v", payload)
	}
}

func TestXAPISessionDoJSONPreemptsLowRemainingRequests(t *testing.T) {
	fakeNow := time.Unix(1_700_000_100, 0)
	var sleeps []time.Duration
	attempts := 0

	session := newXAPITestSession(t, func(w http.ResponseWriter, r *http.Request) {
		attempts++
		w.Header().Set("x-rate-limit-reset", strconv.FormatInt(fakeNow.Add(2*time.Second).Unix(), 10))
		if attempts == 1 {
			w.Header().Set("x-rate-limit-remaining", "1")
		} else {
			w.Header().Set("x-rate-limit-remaining", "10")
		}
		writeJSONResponse(t, w, map[string]any{"ok": true})
	})
	session.owner = &xAPIClient{
		now: func() time.Time { return fakeNow },
		sleep: func(_ context.Context, delay time.Duration) error {
			sleeps = append(sleeps, delay)
			fakeNow = fakeNow.Add(delay)
			return nil
		},
		rateLimitDelay: xRateLimitCooldown,
		retryCount:     4,
		rateLimitRoll:  func() int { return 5 },
	}

	var payload map[string]any
	if err := session.doJSON(context.Background(), "fetch", http.MethodGet, xAPIRootURL, xUserMediaPath, nil, true, &payload); err != nil {
		t.Fatalf("doJSON returned error: %v", err)
	}
	if attempts != 2 {
		t.Fatalf("expected low-remaining retry to issue 2 attempts, got %d", attempts)
	}
	if len(sleeps) != 1 || sleeps[0] != 3*time.Second {
		t.Fatalf("expected one 3s preemptive wait, got %v", sleeps)
	}
}

func TestXResolveUserLookupResultMissingUserReturnsFallback(t *testing.T) {
	_, err := xResolveUserLookupResult(xUserByScreenNameEnvelope{})
	if err == nil {
		t.Fatal("expected missing user lookup result to trigger fallback")
	}
	if !errors.Is(err, ErrEngineFallbackRequired) {
		t.Fatalf("expected fallback required, got %v", err)
	}
	metadata, ok := xFallbackDetails(err)
	if !ok {
		t.Fatal("expected fallback metadata")
	}
	if metadata.Stage != "lookup" || metadata.Code != "missing_user_result" {
		t.Fatalf("unexpected fallback metadata: %+v", metadata)
	}
}

func TestParseXMediaTimelinePageMissingInstructionsReturnsFallback(t *testing.T) {
	envelope := &xUserMediaEnvelope{}
	_, err := parseXMediaTimelinePage(envelope, "all")
	if err == nil {
		t.Fatal("expected missing instructions to trigger fallback")
	}
	if !errors.Is(err, ErrEngineFallbackRequired) {
		t.Fatalf("expected fallback required, got %v", err)
	}
	metadata, ok := xFallbackDetails(err)
	if !ok {
		t.Fatal("expected fallback metadata")
	}
	if metadata.Stage != "parse" || metadata.Code != "missing_instructions" {
		t.Fatalf("unexpected fallback metadata: %+v", metadata)
	}
}

func decodeUserMediaEnvelope(t *testing.T, payload map[string]any) *xUserMediaEnvelope {
	t.Helper()

	data, err := json.Marshal(payload)
	if err != nil {
		t.Fatalf("marshal fixture: %v", err)
	}

	var envelope xUserMediaEnvelope
	if err := json.Unmarshal(data, &envelope); err != nil {
		t.Fatalf("unmarshal fixture: %v", err)
	}
	return &envelope
}

func fixtureXUser() xUserResult {
	user := xUserResult{
		TypeName: "__typename:User",
		RestID:   "424242",
	}
	user.Avatar.ImageURL = "https://pbs.twimg.com/profile_images/example/avatar_normal.jpg"
	user.Core.CreatedAt = "Wed Dec 19 20:20:32 +0000 2007"
	user.Core.Name = "Example Display"
	user.Core.ScreenName = "example_user"
	user.Legacy.Description = "Space account"
	user.Legacy.FavouritesCount = 21
	user.Legacy.FollowersCount = 1200
	user.Legacy.FriendsCount = 34
	user.Legacy.ListedCount = 8
	user.Legacy.MediaCount = 55
	user.Legacy.StatusesCount = 77
	user.Legacy.ProfileBanner = "https://pbs.twimg.com/profile_banners/example/banner"
	user.Legacy.URL = "https://t.co/example"
	user.Legacy.Entities.URL.URLs = []struct {
		ExpandedURL string `json:"expanded_url"`
		URL         string `json:"url"`
	}{
		{
			ExpandedURL: "https://example.com",
			URL:         "https://t.co/example",
		},
	}
	user.Location.Location = "Low Earth Orbit"
	user.Verification.Verified = false
	user.Privacy.Protected = false
	return user
}

func fixtureFirstPagePayload(t *testing.T) map[string]any {
	t.Helper()

	return map[string]any{
		"data": map[string]any{
			"user": map[string]any{
				"result": map[string]any{
					"__typename": "User",
					"timeline": map[string]any{
						"timeline": map[string]any{
							"instructions": []any{
								map[string]any{
									"type": "TimelineAddEntries",
									"entries": []any{
										map[string]any{
											"entryId": "profile-grid-0",
											"content": map[string]any{
												"items": []any{
													fixtureModuleItem("9001", "photo", "https://pbs.twimg.com/media/photo-one.jpg", nil),
													fixtureModuleItem("9002", "video", "", []map[string]any{
														{"content_type": "video/mp4", "bitrate": 832000, "url": "https://video.twimg.com/video_low.mp4?tag=12"},
														{"content_type": "video/mp4", "bitrate": 2176000, "url": "https://video.twimg.com/video_high.mp4?tag=18"},
													}),
													fixtureModuleItem("9003", "animated_gif", "", []map[string]any{
														{"content_type": "video/mp4", "url": "https://video.twimg.com/gif.mp4"},
													}),
													fixtureModuleItem("9001", "photo", "https://pbs.twimg.com/media/photo-one.jpg", nil),
												},
											},
										},
										map[string]any{
											"entryId": "cursor-top-1",
											"content": map[string]any{
												"value": "top-cursor",
											},
										},
										map[string]any{
											"entryId": "cursor-bottom-1",
											"content": map[string]any{
												"value": "cursor-1",
											},
										},
									},
								},
							},
						},
					},
				},
			},
		},
	}
}

func fixtureContinuationPayload(t *testing.T) map[string]any {
	t.Helper()

	return map[string]any{
		"data": map[string]any{
			"user": map[string]any{
				"result": map[string]any{
					"__typename": "User",
					"timeline": map[string]any{
						"timeline": map[string]any{
							"instructions": []any{
								map[string]any{
									"type":          "TimelineAddToModule",
									"moduleEntryId": "profile-grid-0",
									"moduleItems": []any{
										fixtureModuleItem("9002", "video", "", []map[string]any{
											{"content_type": "video/mp4", "bitrate": 512000, "url": "https://video.twimg.com/video_second.mp4?tag=18"},
										}),
									},
								},
								map[string]any{
									"type": "TimelineAddEntries",
									"entries": []any{
										map[string]any{
											"entryId": "cursor-top-2",
											"content": map[string]any{
												"value": "top-cursor-2",
											},
										},
										map[string]any{
											"entryId": "cursor-bottom-2",
											"content": map[string]any{
												"value": "cursor-2",
											},
										},
									},
								},
							},
						},
					},
				},
			},
		},
	}
}

func fixtureModuleItem(tweetID string, mediaType string, mediaURL string, variants []map[string]any) map[string]any {
	media := map[string]any{
		"type":            mediaType,
		"ext_alt_text":    "Alt text",
		"media_url_https": mediaURL,
		"original_info":   map[string]any{"width": 1600, "height": 900},
	}
	if len(variants) > 0 {
		media["video_info"] = map[string]any{
			"duration_millis": 12000,
			"variants":        variants,
		}
	}

	return map[string]any{
		"entryId": "profile-grid-0-tweet-" + tweetID,
		"item": map[string]any{
			"itemContent": map[string]any{
				"__typename": "TimelineTweet",
				"itemType":   "TimelineTweet",
				"tweet_results": map[string]any{
					"result": map[string]any{
						"__typename": "Tweet",
						"rest_id":    tweetID,
						"core": map[string]any{
							"user_results": map[string]any{
								"result": fixtureUserResultMap(),
							},
						},
						"legacy": map[string]any{
							"bookmark_count":      12,
							"conversation_id_str": tweetID,
							"created_at":          "Tue Apr 14 18:30:00 +0000 2026",
							"favorite_count":      42,
							"full_text":           "A sample post from orbit",
							"lang":                "en",
							"possibly_sensitive":  false,
							"quote_count":         4,
							"reply_count":         5,
							"retweet_count":       6,
							"source":              "<a href=\"https://www.sprinklr.com\" rel=\"nofollow\">Sprinklr</a>",
							"entities": map[string]any{
								"hashtags": []any{
									map[string]any{"text": "space"},
								},
							},
							"extended_entities": map[string]any{
								"media": []any{media},
							},
						},
					},
				},
			},
		},
	}
}

func fixtureUserResultMap() map[string]any {
	return map[string]any{
		"__typename": "User",
		"rest_id":    "424242",
		"avatar": map[string]any{
			"image_url": "https://pbs.twimg.com/profile_images/example/avatar_normal.jpg",
		},
		"core": map[string]any{
			"created_at":  "Wed Dec 19 20:20:32 +0000 2007",
			"name":        "Example Display",
			"screen_name": "example_user",
		},
		"legacy": map[string]any{
			"description":        "Space account",
			"favourites_count":   21,
			"followers_count":    1200,
			"friends_count":      34,
			"listed_count":       8,
			"media_count":        55,
			"statuses_count":     77,
			"profile_banner_url": "https://pbs.twimg.com/profile_banners/example/banner",
			"url":                "https://t.co/example",
			"entities": map[string]any{
				"url": map[string]any{
					"urls": []any{
						map[string]any{
							"expanded_url": "https://example.com",
							"url":          "https://t.co/example",
						},
					},
				},
			},
		},
		"location": map[string]any{
			"location": "Low Earth Orbit",
		},
		"privacy": map[string]any{
			"protected": false,
		},
		"verification": map[string]any{
			"verified": false,
		},
	}
}

func containsInsensitive(text string, pattern string) bool {
	return strings.Contains(strings.ToLower(text), strings.ToLower(pattern))
}
