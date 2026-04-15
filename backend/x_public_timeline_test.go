package backend

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	neturl "net/url"
	"strings"
	"testing"
	"time"
)

func TestParseXTimelinePageParsesEntriesAcrossShapes(t *testing.T) {
	user := timelineTestUser("timeline_user", "Timeline User", "6000")
	photoTweet := timelineTestTweet("6001", user, "Photo tweet", timelinePhotoEntity("https://pbs.twimg.com/media/timeline-photo.jpg", 1600, 900))
	textTweet := timelineTestTweet("6002", user, "Text tweet")

	parsed, err := parseXTimelinePage([]xTimelineInstruction{
		timelineAddEntries(
			timelineDirectEntry("tweet-6001", photoTweet),
			timelineModuleEntry("module-1", textTweet),
			timelineCursorEntry("cursor-bottom-1", "cursor-1"),
		),
		timelineReplaceCursorInstruction("cursor-bottom-2", "cursor-2"),
	}, xTimelineParseOptions{Filter: "all"})
	if err != nil {
		t.Fatalf("parseXTimelinePage returned error: %v", err)
	}

	if parsed.RawTweetCount != 2 {
		t.Fatalf("expected raw tweet count 2, got %d", parsed.RawTweetCount)
	}
	if len(parsed.Media) != 1 {
		t.Fatalf("expected 1 media item, got %d", len(parsed.Media))
	}
	if len(parsed.Metadata) != 2 {
		t.Fatalf("expected 2 metadata entries, got %d", len(parsed.Metadata))
	}
	if parsed.Cursor != "cursor-2" {
		t.Fatalf("expected cursor-2, got %q", parsed.Cursor)
	}
	if parsed.LastTweetID != "6002" {
		t.Fatalf("expected last tweet id 6002, got %q", parsed.LastTweetID)
	}
}

func TestBuildTimelineTwitterResponseTextOnlyExcludesMediaTweets(t *testing.T) {
	user := timelineTestUser("timeline_user", "Timeline User", "6100")
	photoTweet := timelineTestTweet("6101", user, "Photo tweet", timelinePhotoEntity("https://pbs.twimg.com/media/text-photo.jpg", 1200, 800))
	textTweet := timelineTestTweet("6102", user, "Text tweet")

	parsed, err := parseXTimelinePage([]xTimelineInstruction{
		timelineAddEntries(
			timelineDirectEntry("tweet-6101", photoTweet),
			timelineDirectEntry("tweet-6102", textTweet),
			timelineCursorEntry("cursor-bottom-1", "cursor-text-1"),
		),
	}, xTimelineParseOptions{Filter: "all", TextOnly: true})
	if err != nil {
		t.Fatalf("parseXTimelinePage returned error: %v", err)
	}

	req := TimelineRequest{
		Username:  "timeline_user",
		MediaType: "text",
		BatchSize: 20,
		Page:      1,
	}
	response := buildTimelineTwitterResponse(req, buildTimelineExtractorSpec(req), user, parsed, "1/cursor-text-1", false)
	if len(response.Timeline) != 1 {
		t.Fatalf("expected 1 text entry, got %d", len(response.Timeline))
	}
	if response.Timeline[0].TweetID != TweetIDString(6102) || response.Timeline[0].Type != "text" {
		t.Fatalf("unexpected text entry: %#v", response.Timeline[0])
	}
}

func TestXPrepareTimelineTweetRetweetBehavior(t *testing.T) {
	originalAuthor := timelineTestUser("orig_user", "Original User", "6201")
	retweeter := timelineTestUser("retweeter", "Retweeter", "6202")
	originalTweet := timelineTestTweet("6203", originalAuthor, "Original content")
	retweet := timelineTestTweet("6204", retweeter, "RT placeholder")
	retweet.Legacy.RetweetedStatusResult = &struct {
		Result xTweetResult `json:"result"`
	}{Result: originalTweet}

	prepared, skip, err := xPrepareTimelineTweet(retweet, false)
	if err != nil {
		t.Fatalf("xPrepareTimelineTweet returned error: %v", err)
	}
	if !skip || prepared != nil {
		t.Fatalf("expected retweet to be skipped when retweets are disabled: prepared=%#v skip=%t", prepared, skip)
	}

	prepared, skip, err = xPrepareTimelineTweet(retweet, true)
	if err != nil {
		t.Fatalf("xPrepareTimelineTweet returned error: %v", err)
	}
	if skip || prepared == nil {
		t.Fatal("expected retweet to be included when retweets are enabled")
	}
	if prepared.RetweetID != TweetIDString(6203) {
		t.Fatalf("expected retweet id 6203, got %v", prepared.RetweetID)
	}
	if prepared.Author.Name != "orig_user" {
		t.Fatalf("expected original author, got %#v", prepared.Author)
	}
	if prepared.Tweet.Legacy.FullText != "Original content" {
		t.Fatalf("expected original content, got %q", prepared.Tweet.Legacy.FullText)
	}
}

func TestXParseTimelineStageCursorRoundTrip(t *testing.T) {
	tests := []struct {
		name      string
		raw       string
		wantStage int
		wantTweet string
		wantRaw   string
		wantBuild string
	}{
		{name: "empty", raw: "", wantStage: 0, wantTweet: "", wantRaw: "", wantBuild: ""},
		{name: "raw cursor", raw: "raw-cursor", wantStage: 1, wantTweet: "", wantRaw: "raw-cursor", wantBuild: "1/raw-cursor"},
		{name: "stage 1", raw: "1/cursor-1", wantStage: 1, wantTweet: "", wantRaw: "cursor-1", wantBuild: "1/cursor-1"},
		{name: "stage 2", raw: "2_9001/", wantStage: 2, wantTweet: "9001", wantRaw: "", wantBuild: "2_9001/"},
		{name: "stage 3", raw: "3_9002/cursor-3", wantStage: 3, wantTweet: "9002", wantRaw: "cursor-3", wantBuild: "3_9002/cursor-3"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			cursor, err := xParseTimelineStageCursor(tt.raw)
			if err != nil {
				t.Fatalf("xParseTimelineStageCursor returned error: %v", err)
			}
			if cursor.Stage != tt.wantStage || cursor.TweetID != tt.wantTweet || cursor.RawCursor != tt.wantRaw {
				t.Fatalf("unexpected cursor: %+v", cursor)
			}
			if tt.wantBuild != "" {
				if got := xBuildTimelineStageCursor(cursor.Stage, cursor.TweetID, cursor.RawCursor); got != tt.wantBuild {
					t.Fatalf("expected %q, got %q", tt.wantBuild, got)
				}
			}
		})
	}
}

func TestXParseTimelineStageCursorRejectsSearchStageWithoutTweetID(t *testing.T) {
	_, err := xParseTimelineStageCursor("2/")
	if err == nil {
		t.Fatal("expected invalid stage cursor")
	}
	assertXFallback(t, err, "normalize", "invalid_timeline_cursor")
}

func TestXTimelineStageOneUsesUserTweets(t *testing.T) {
	tests := []struct {
		name string
		req  TimelineRequest
		want bool
	}{
		{
			name: "media default uses user media",
			req:  TimelineRequest{Username: "example", TimelineType: "timeline", MediaType: "all"},
			want: false,
		},
		{
			name: "text only uses user tweets",
			req:  TimelineRequest{Username: "example", MediaType: "text"},
			want: true,
		},
		{
			name: "retweets use user tweets",
			req:  TimelineRequest{Username: "example", TimelineType: "timeline", MediaType: "all", Retweets: true},
			want: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := xTimelineStageOneUsesUserTweets(buildTimelineExtractorSpec(tt.req)); got != tt.want {
				t.Fatalf("expected %t, got %t", tt.want, got)
			}
		})
	}
}

func TestXBuildTimelineSearchQueryIncludesRetweetsAndLinks(t *testing.T) {
	user := timelineTestUser("timeline_user", "Timeline User", "6300")
	query := xBuildTimelineSearchQuery(user, "7001", true, true)
	if !strings.Contains(query, "from:timeline_user") {
		t.Fatalf("expected query to include screen name, got %q", query)
	}
	if !strings.Contains(query, "max_id:7001") {
		t.Fatalf("expected query to include max_id, got %q", query)
	}
	if !strings.Contains(query, "filter:links") {
		t.Fatalf("expected query to include filter:links, got %q", query)
	}
	if !strings.Contains(query, "include:retweets include:nativeretweets") {
		t.Fatalf("expected query to include retweet flags, got %q", query)
	}
}

func TestXMergeParsedTimelinePageDeduplicatesAcrossStages(t *testing.T) {
	user := timelineTestUser("timeline_user", "Timeline User", "6400")
	photoTweet := timelineTestTweet("6401", user, "Photo tweet", timelinePhotoEntity("https://pbs.twimg.com/media/merge-photo.jpg", 1200, 800))

	first, err := parseXTimelinePage([]xTimelineInstruction{
		timelineAddEntries(timelineDirectEntry("tweet-6401", photoTweet)),
	}, xTimelineParseOptions{Filter: "all"})
	if err != nil {
		t.Fatalf("first parse returned error: %v", err)
	}
	second, err := parseXTimelinePage([]xTimelineInstruction{
		timelineAddEntries(timelineModuleEntry("module-1", photoTweet)),
	}, xTimelineParseOptions{Filter: "all"})
	if err != nil {
		t.Fatalf("second parse returned error: %v", err)
	}

	xMergeParsedTimelinePage(first, second)
	if len(first.Media) != 1 {
		t.Fatalf("expected deduplicated media count 1, got %d", len(first.Media))
	}
	if len(first.Metadata) != 1 {
		t.Fatalf("expected deduplicated metadata count 1, got %d", len(first.Metadata))
	}
}

func TestParseXTimelinePageMissingCoreReturnsFallback(t *testing.T) {
	user := timelineTestUser("timeline_user", "Timeline User", "6500")
	tweet := timelineTestTweet("6501", user, "Broken tweet")
	tweet.Core.UserResults.Result = xUserResult{}

	_, err := parseXTimelinePage([]xTimelineInstruction{
		timelineAddEntries(timelineDirectEntry("tweet-6501", tweet)),
	}, xTimelineParseOptions{Filter: "all"})
	if err == nil {
		t.Fatal("expected missing core to trigger fallback")
	}
	assertXFallback(t, err, "parse", "missing_core_user")
}

func TestFetchUserTweetsPageUsesRawCursor(t *testing.T) {
	user := timelineTestUser("timeline_user", "Timeline User", "6600")
	textTweet := timelineTestTweet("6601", user, "Direct tweet")
	var capturedPath string
	var capturedCursor string

	session := newXAPITestSession(t, func(w http.ResponseWriter, r *http.Request) {
		capturedPath = r.URL.Path
		variables := decodeVariables(t, r)
		if cursor, ok := variables["cursor"].(string); ok {
			capturedCursor = cursor
		}
		writeJSONResponse(t, w, userTimelineEnvelope(
			timelineAddEntries(
				timelineDirectEntry("tweet-6601", textTweet),
				timelineCursorEntry("cursor-bottom-1", "cursor-direct-1"),
			),
		))
	})

	page, err := session.fetchUserTweetsPage(context.Background(), user.RestID, 50, "raw-cursor", false)
	if err != nil {
		t.Fatalf("fetchUserTweetsPage returned error: %v", err)
	}
	if !strings.HasSuffix(capturedPath, xUserTweetsPath) {
		t.Fatalf("expected path suffix %s, got %s", xUserTweetsPath, capturedPath)
	}
	if capturedCursor != "raw-cursor" {
		t.Fatalf("expected raw cursor, got %q", capturedCursor)
	}

	parsed, err := parseXTimelinePage(page.Data.User.Result.Timeline.Timeline.Instructions, xTimelineParseOptions{Filter: "all", TextOnly: true})
	if err != nil {
		t.Fatalf("parseXTimelinePage returned error: %v", err)
	}
	req := TimelineRequest{Username: user.Core.ScreenName, TimelineType: "tweets", MediaType: "text", BatchSize: 20, Page: 1, Cursor: "raw-cursor"}
	response, err := buildDirectTimelineResponse(req, user, buildTimelineExtractorSpec(req), parsed)
	if err != nil {
		t.Fatalf("buildDirectTimelineResponse returned error: %v", err)
	}
	if response.Cursor != "cursor-direct-1" {
		t.Fatalf("expected raw response cursor, got %q", response.Cursor)
	}
}

func TestFetchUserTweetsPageWithRepliesUsesRepliesPath(t *testing.T) {
	user := timelineTestUser("timeline_user", "Timeline User", "6700")
	var capturedPath string

	session := newXAPITestSession(t, func(w http.ResponseWriter, r *http.Request) {
		capturedPath = r.URL.Path
		writeJSONResponse(t, w, userTimelineEnvelope(timelineAddEntries()))
	})

	if _, err := session.fetchUserTweetsPage(context.Background(), user.RestID, 50, "", true); err != nil {
		t.Fatalf("fetchUserTweetsPage returned error: %v", err)
	}
	if !strings.HasSuffix(capturedPath, xUserTweetsRepliesPath) {
		t.Fatalf("expected path suffix %s, got %s", xUserTweetsRepliesPath, capturedPath)
	}
}

func TestFetchSearchTimelineStagePrefersMaxIDResume(t *testing.T) {
	user := timelineTestUser("timeline_user", "Timeline User", "6800")
	searchTweet := timelineTestTweet("6802", user, "Search result")
	var capturedQuery string

	session := newXAPITestSession(t, func(w http.ResponseWriter, r *http.Request) {
		variables := decodeVariables(t, r)
		capturedQuery, _ = variables["rawQuery"].(string)
		writeJSONResponse(t, w, searchTimelineEnvelope(
			timelineAddEntries(
				timelineDirectEntry("tweet-6802", searchTweet),
				timelineCursorEntry("cursor-bottom-1", "cursor-search-1"),
			),
		))
	})

	result, err := session.fetchSearchTimelineStage(
		context.Background(),
		xBuildTimelineSearchQuery(user, "6801", true, false),
		50,
		xTimelineStageCursor{Stage: xTimelineStageSearchLinks, TweetID: "6801"},
		xTimelineParseOptions{Filter: "all"},
	)
	if err != nil {
		t.Fatalf("fetchSearchTimelineStage returned error: %v", err)
	}
	if !strings.Contains(capturedQuery, "filter:links") {
		t.Fatalf("expected stage 2 query to contain filter:links, got %q", capturedQuery)
	}
	if result.ResumeCursor != "2_6802/" {
		t.Fatalf("expected max-id resume cursor, got %q", result.ResumeCursor)
	}
}

func TestExtractStagedTimelinePrefixesStageOneCursor(t *testing.T) {
	user := timelineTestUser("timeline_user", "Timeline User", "6900")
	photoTweet := timelineTestTweet("6901", user, "Media tweet", timelinePhotoEntity("https://pbs.twimg.com/media/stage-photo.jpg", 1400, 900))

	session := newXAPITestSession(t, func(w http.ResponseWriter, r *http.Request) {
		writeJSONResponse(t, w, userTimelineEnvelope(
			timelineAddEntries(
				timelineModuleEntry("profile-grid-0", photoTweet),
				timelineCursorEntry("cursor-bottom-1", "media-stage-cursor"),
			),
		))
	})

	req := TimelineRequest{Username: user.Core.ScreenName, TimelineType: "timeline", MediaType: "all", BatchSize: 20, Page: 1}
	response, err := (&xAPIClient{}).extractStagedTimeline(
		context.Background(),
		req,
		buildTimelineExtractorSpec(req),
		user,
		session,
		xTimelineParseOptions{Filter: "all"},
		&xPublicTimelineDiagnosticLogEntry{},
	)
	if err != nil {
		t.Fatalf("extractStagedTimeline returned error: %v", err)
	}
	if response.Cursor != "1/media-stage-cursor" {
		t.Fatalf("expected prefixed stage cursor, got %q", response.Cursor)
	}
	if response.Completed {
		t.Fatal("expected response to remain incomplete when stage 1 has cursor")
	}
}

func TestExtractStagedTimelineFallsThroughSearchStages(t *testing.T) {
	user := timelineTestUser("timeline_user", "Timeline User", "7000")
	photoTweet := timelineTestTweet("7001", user, "Stage one media", timelinePhotoEntity("https://pbs.twimg.com/media/stage1-photo.jpg", 1400, 900))
	textTweet := timelineTestTweet("7002", user, "Stage three text")
	var queries []string

	session := newXAPITestSession(t, func(w http.ResponseWriter, r *http.Request) {
		switch {
		case strings.HasSuffix(r.URL.Path, xUserMediaPath):
			writeJSONResponse(t, w, userTimelineEnvelope(
				timelineAddEntries(timelineModuleEntry("profile-grid-0", photoTweet)),
			))
		case strings.HasSuffix(r.URL.Path, xSearchTimelinePath):
			variables := decodeVariables(t, r)
			rawQuery, _ := variables["rawQuery"].(string)
			queries = append(queries, rawQuery)
			if strings.Contains(rawQuery, "filter:links") {
				writeJSONResponse(t, w, searchTimelineEnvelope(timelineAddEntries()))
				return
			}
			writeJSONResponse(t, w, searchTimelineEnvelope(
				timelineAddEntries(timelineDirectEntry("tweet-7002", textTweet)),
			))
		default:
			t.Fatalf("unexpected request path %s", r.URL.Path)
		}
	})

	req := TimelineRequest{Username: user.Core.ScreenName, TimelineType: "timeline", MediaType: "all", BatchSize: 20, Page: 1}
	response, err := (&xAPIClient{}).extractStagedTimeline(
		context.Background(),
		req,
		buildTimelineExtractorSpec(req),
		user,
		session,
		xTimelineParseOptions{Filter: "all"},
		&xPublicTimelineDiagnosticLogEntry{},
	)
	if err != nil {
		t.Fatalf("extractStagedTimeline returned error: %v", err)
	}
	if len(queries) != 2 {
		t.Fatalf("expected 2 search queries, got %d", len(queries))
	}
	if !strings.Contains(queries[0], "filter:links") {
		t.Fatalf("expected stage 2 query to include filter:links, got %q", queries[0])
	}
	if strings.Contains(queries[1], "filter:links") {
		t.Fatalf("expected stage 3 query to remove filter:links, got %q", queries[1])
	}
	if response.Cursor != "3_7002/" {
		t.Fatalf("expected stage 3 resume cursor, got %q", response.Cursor)
	}
	if len(response.Timeline) != 1 || response.Timeline[0].Type != "photo" {
		t.Fatalf("expected media-first timeline response, got %#v", response.Timeline)
	}
}

func TestExtractStagedTimelineTextOnlySkipsStageTwo(t *testing.T) {
	user := timelineTestUser("timeline_user", "Timeline User", "7100")
	firstTweet := timelineTestTweet("7101", user, "Stage one text")
	secondTweet := timelineTestTweet("7102", user, "Stage three text")
	var queries []string

	session := newXAPITestSession(t, func(w http.ResponseWriter, r *http.Request) {
		switch {
		case strings.HasSuffix(r.URL.Path, xUserTweetsPath):
			writeJSONResponse(t, w, userTimelineEnvelope(
				timelineAddEntries(timelineDirectEntry("tweet-7101", firstTweet)),
			))
		case strings.HasSuffix(r.URL.Path, xSearchTimelinePath):
			variables := decodeVariables(t, r)
			rawQuery, _ := variables["rawQuery"].(string)
			queries = append(queries, rawQuery)
			writeJSONResponse(t, w, searchTimelineEnvelope(
				timelineAddEntries(timelineDirectEntry("tweet-7102", secondTweet)),
			))
		default:
			t.Fatalf("unexpected request path %s", r.URL.Path)
		}
	})

	req := TimelineRequest{Username: user.Core.ScreenName, TimelineType: "timeline", MediaType: "text", BatchSize: 20, Page: 1}
	response, err := (&xAPIClient{}).extractStagedTimeline(
		context.Background(),
		req,
		buildTimelineExtractorSpec(req),
		user,
		session,
		xTimelineParseOptions{Filter: "all", TextOnly: true},
		&xPublicTimelineDiagnosticLogEntry{},
	)
	if err != nil {
		t.Fatalf("extractStagedTimeline returned error: %v", err)
	}
	if len(queries) != 1 {
		t.Fatalf("expected exactly 1 search query, got %d", len(queries))
	}
	if strings.Contains(queries[0], "filter:links") {
		t.Fatalf("expected text-only timeline to skip stage 2 links query, got %q", queries[0])
	}
	if response.Cursor != "3_7102/" {
		t.Fatalf("expected stage 3 resume cursor, got %q", response.Cursor)
	}
	if len(response.Timeline) != 2 || response.Timeline[0].Type != "text" || response.Timeline[1].Type != "text" {
		t.Fatalf("expected two text entries, got %#v", response.Timeline)
	}
}

type rewriteRoundTripper struct {
	target *neturl.URL
	base   http.RoundTripper
}

func (r rewriteRoundTripper) RoundTrip(req *http.Request) (*http.Response, error) {
	clone := req.Clone(req.Context())
	clone.URL.Scheme = r.target.Scheme
	clone.URL.Host = r.target.Host
	clone.Host = r.target.Host
	return r.base.RoundTrip(clone)
}

func newXAPITestSession(t *testing.T, handler http.HandlerFunc) *xAPISession {
	t.Helper()

	server := httptest.NewServer(handler)
	t.Cleanup(server.Close)

	target, err := neturl.Parse(server.URL)
	if err != nil {
		t.Fatalf("parse test server url: %v", err)
	}
	jar, err := cookiejar.New(nil)
	if err != nil {
		t.Fatalf("create cookie jar: %v", err)
	}

	client := &http.Client{
		Jar:       jar,
		Transport: rewriteRoundTripper{target: target, base: server.Client().Transport},
		Timeout:   time.Second * 5,
	}
	session := &xAPISession{
		owner:      &xAPIClient{},
		httpClient: client,
		authToken:  "auth-token",
	}
	session.seedAuthCookies("0123456789abcdef0123456789abcdef")
	return session
}

func decodeVariables(t *testing.T, r *http.Request) map[string]any {
	t.Helper()

	raw := r.URL.Query().Get("variables")
	if raw == "" {
		return map[string]any{}
	}
	var decoded map[string]any
	if err := json.Unmarshal([]byte(raw), &decoded); err != nil {
		t.Fatalf("decode variables: %v", err)
	}
	return decoded
}

func writeJSONResponse(t *testing.T, w http.ResponseWriter, value any) {
	t.Helper()

	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(value); err != nil {
		t.Fatalf("encode response: %v", err)
	}
}

func userTimelineEnvelope(instructions ...xTimelineInstruction) xUserMediaEnvelope {
	var envelope xUserMediaEnvelope
	envelope.Data.User.Result.Timeline.Timeline.Instructions = instructions
	return envelope
}

func searchTimelineEnvelope(instructions ...xTimelineInstruction) xSearchTimelineEnvelope {
	var envelope xSearchTimelineEnvelope
	envelope.Data.SearchByRawQuery.SearchTimeline.Timeline.Instructions = instructions
	return envelope
}

func timelineAddEntries(entries ...xTimelineEntry) xTimelineInstruction {
	return xTimelineInstruction{
		Type:    "TimelineAddEntries",
		Entries: entries,
	}
}

func timelineReplaceCursorInstruction(entryID string, cursor string) xTimelineInstruction {
	return xTimelineInstruction{
		Type: "TimelineReplaceEntry",
		Entry: xTimelineEntry{
			EntryID: entryID,
			Content: xTimelineEntryContent{Value: cursor},
		},
	}
}

func timelineDirectEntry(entryID string, tweet xTweetResult) xTimelineEntry {
	return xTimelineEntry{
		EntryID: entryID,
		Content: xTimelineEntryContent{
			ItemContent: timelineItemContent(tweet),
		},
	}
}

func timelineModuleEntry(entryID string, tweets ...xTweetResult) xTimelineEntry {
	entries := make([]xTimelineModuleItem, 0, len(tweets))
	for idx, tweet := range tweets {
		entries = append(entries, xTimelineModuleItem{
			EntryID: entryID + "-" + string(rune('a'+idx)),
			Item: struct {
				ItemContent xTimelineItemContent `json:"itemContent"`
			}{
				ItemContent: timelineItemContent(tweet),
			},
		})
	}
	return xTimelineEntry{
		EntryID: entryID,
		Content: xTimelineEntryContent{
			Items: entries,
		},
	}
}

func timelineCursorEntry(entryID string, cursor string) xTimelineEntry {
	return xTimelineEntry{
		EntryID: entryID,
		Content: xTimelineEntryContent{
			Value: cursor,
		},
	}
}

func timelineItemContent(tweet xTweetResult) xTimelineItemContent {
	content := xTimelineItemContent{
		TypeName: "__typename",
		ItemType: "TimelineTweet",
	}
	content.TweetResults.Result = tweet
	return content
}

func timelineTestUser(screenName string, displayName string, restID string) xUserResult {
	user := fixtureXUser()
	user.RestID = restID
	user.Core.ScreenName = screenName
	user.Core.Name = displayName
	user.Avatar.ImageURL = "https://pbs.twimg.com/profile_images/" + screenName + "/avatar_normal.jpg"
	user.Legacy.ProfileBanner = "https://pbs.twimg.com/profile_banners/" + screenName + "/banner"
	user.Legacy.URL = "https://t.co/" + screenName
	user.Legacy.Entities.URL.URLs = []struct {
		ExpandedURL string `json:"expanded_url"`
		URL         string `json:"url"`
	}{
		{
			ExpandedURL: "https://example.com/" + screenName,
			URL:         "https://t.co/" + screenName,
		},
	}
	return user
}

func timelineTestTweet(restID string, user xUserResult, content string, media ...xMediaEntity) xTweetResult {
	tweet := xTweetResult{
		RestID: restID,
	}
	tweet.Core.UserResults.Result = user
	tweet.Legacy.BookmarkCount = 3
	tweet.Legacy.ConversationIDStr = restID
	tweet.Legacy.CreatedAt = "Tue Apr 14 18:30:00 +0000 2026"
	tweet.Legacy.Entities.Hashtags = []struct {
		Text string `json:"text"`
	}{
		{Text: "space"},
	}
	tweet.Legacy.ExtendedEntities.Media = media
	tweet.Legacy.FavoriteCount = 10
	tweet.Legacy.FullText = content
	tweet.Legacy.Lang = "en"
	tweet.Legacy.QuoteCount = 2
	tweet.Legacy.ReplyCount = 4
	tweet.Legacy.RetweetCount = 5
	tweet.Legacy.Source = `<a href="https://www.sprinklr.com" rel="nofollow">Sprinklr</a>`
	return tweet
}

func timelinePhotoEntity(mediaURL string, width int, height int) xMediaEntity {
	return xMediaEntity{
		Type:          "photo",
		MediaURLHTTPS: mediaURL,
		OriginalInfo: xOriginalInfo{
			Width:  width,
			Height: height,
		},
	}
}

func TestFetchSearchTimelineStageRequiresTweetID(t *testing.T) {
	session := newXAPITestSession(t, func(w http.ResponseWriter, r *http.Request) {
		t.Fatal("unexpected network request")
	})
	_, err := session.fetchSearchTimelineStage(
		context.Background(),
		"from:timeline_user max_id:7001",
		50,
		xTimelineStageCursor{Stage: xTimelineStageSearchLinks},
		xTimelineParseOptions{Filter: "all"},
	)
	if err == nil {
		t.Fatal("expected missing search tweet id fallback")
	}
	if !errors.Is(err, ErrEngineFallbackRequired) {
		t.Fatalf("expected fallback error, got %v", err)
	}
	assertXFallback(t, err, "normalize", "missing_search_tweet_id")
}
