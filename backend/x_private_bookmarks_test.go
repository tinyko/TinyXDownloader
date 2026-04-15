package backend

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"testing"
)

func TestFetchBookmarksPageUsesBookmarksPathAndRawCursor(t *testing.T) {
	textTweet := timelineTestTweet("8601", timelineTestUser("bookmark_author", "Bookmark Author", "8600"), "Bookmarked tweet")
	var capturedPath string
	var capturedCursor string

	session := newXAPITestSession(t, func(w http.ResponseWriter, r *http.Request) {
		capturedPath = r.URL.Path
		variables := decodeVariables(t, r)
		if cursor, ok := variables["cursor"].(string); ok {
			capturedCursor = cursor
		}
		writeJSONResponse(t, w, bookmarksTimelineEnvelope(
			timelineAddEntries(
				timelineDirectEntry("tweet-8601", textTweet),
				timelineCursorEntry("cursor-bottom-1", "bookmarks-cursor-1"),
			),
		))
	})

	page, err := session.fetchBookmarksPage(context.Background(), 50, "raw-bookmarks-cursor")
	if err != nil {
		t.Fatalf("fetchBookmarksPage returned error: %v", err)
	}
	if !strings.HasSuffix(capturedPath, xBookmarksPath) {
		t.Fatalf("expected path suffix %s, got %s", xBookmarksPath, capturedPath)
	}
	if capturedCursor != "raw-bookmarks-cursor" {
		t.Fatalf("expected raw bookmarks cursor, got %q", capturedCursor)
	}
	if len(page.Data.BookmarkTimelineV2.Timeline.Instructions) == 0 {
		t.Fatal("expected bookmarks timeline instructions")
	}
}

func TestBuildPrivateBookmarksTimelineResponseUsesMyBookmarksAccountInfo(t *testing.T) {
	photoTweet := timelineTestTweet(
		"8701",
		timelineTestUser("bookmark_author", "Bookmark Author", "8700"),
		"Bookmarked photo",
		timelinePhotoEntity("https://pbs.twimg.com/media/private-bookmarks-photo.jpg", 1600, 900),
	)

	parsed, err := parseXTimelinePage([]xTimelineInstruction{
		timelineAddEntries(
			timelineDirectEntry("tweet-8701", photoTweet),
			timelineCursorEntry("cursor-bottom-1", "bookmarks-page-1"),
		),
	}, xTimelineParseOptions{Filter: "all"})
	if err != nil {
		t.Fatalf("parseXTimelinePage returned error: %v", err)
	}

	response, err := buildPrivateBookmarksTimelineResponseFromParsed(TimelineRequest{
		TimelineType: "bookmarks",
		MediaType:    "all",
		BatchSize:    20,
		Page:         1,
	}, parsed)
	if err != nil {
		t.Fatalf("buildPrivateBookmarksTimelineResponseFromParsed returned error: %v", err)
	}

	if response.AccountInfo.Name != "bookmarks" || response.AccountInfo.Nick != "My Bookmarks" {
		t.Fatalf("unexpected bookmarks account info names: %#v", response.AccountInfo)
	}
	if response.AccountInfo.ProfileImage != "" || response.AccountInfo.FollowersCount != 0 {
		t.Fatalf("expected best-effort bookmarks account info, got %#v", response.AccountInfo)
	}
	if response.Cursor != "bookmarks-page-1" || response.Completed {
		t.Fatalf("unexpected continuation state: cursor=%q completed=%t", response.Cursor, response.Completed)
	}
	if len(response.Timeline) != 1 || response.Timeline[0].AuthorUsername != "bookmark_author" {
		t.Fatalf("unexpected timeline response: %#v", response.Timeline)
	}
}

func TestBuildPrivateBookmarksTimelineResponseTextOnlyExcludesMediaTweets(t *testing.T) {
	user := timelineTestUser("bookmark_author", "Bookmark Author", "8800")
	photoTweet := timelineTestTweet("8801", user, "Bookmarked photo", timelinePhotoEntity("https://pbs.twimg.com/media/private-bookmarks-text-photo.jpg", 1200, 800))
	textTweet := timelineTestTweet("8802", user, "Bookmarked text only")

	parsed, err := parseXTimelinePage([]xTimelineInstruction{
		timelineAddEntries(
			timelineDirectEntry("tweet-8801", photoTweet),
			timelineDirectEntry("tweet-8802", textTweet),
			timelineCursorEntry("cursor-bottom-1", "bookmarks-text-cursor"),
		),
	}, xTimelineParseOptions{Filter: "all", TextOnly: true})
	if err != nil {
		t.Fatalf("parseXTimelinePage returned error: %v", err)
	}

	response, err := buildPrivateBookmarksTimelineResponseFromParsed(TimelineRequest{
		TimelineType: "bookmarks",
		MediaType:    "text",
		BatchSize:    20,
		Page:         1,
	}, parsed)
	if err != nil {
		t.Fatalf("buildPrivateBookmarksTimelineResponseFromParsed returned error: %v", err)
	}
	if len(response.Timeline) != 1 {
		t.Fatalf("expected 1 text-only entry, got %d", len(response.Timeline))
	}
	if response.Timeline[0].TweetID != TweetIDString(8802) || response.Timeline[0].Type != "text" {
		t.Fatalf("unexpected text-only entry: %#v", response.Timeline[0])
	}
}

func TestExtractPrivateBookmarksTimelineAllowsEmptyUsername(t *testing.T) {
	photoTweet := timelineTestTweet(
		"8901",
		timelineTestUser("bookmark_author", "Bookmark Author", "8900"),
		"Bookmarked media",
		timelinePhotoEntity("https://pbs.twimg.com/media/private-bookmarks-int-photo.jpg", 1400, 900),
	)
	bookmarksRequests := 0

	client := newXAPITestClient(t, func(w http.ResponseWriter, r *http.Request) {
		if !strings.HasSuffix(r.URL.Path, xBookmarksPath) {
			t.Fatalf("unexpected request path %s", r.URL.Path)
		}
		bookmarksRequests++
		writeJSONResponse(t, w, bookmarksTimelineEnvelope(
			timelineAddEntries(
				timelineDirectEntry("tweet-8901", photoTweet),
				timelineCursorEntry("cursor-bottom-1", "bookmarks-live-cursor"),
			),
		))
	})

	response, err := client.extractPrivateBookmarksTimeline(context.Background(), TimelineRequest{
		Username:     "",
		AuthToken:    "auth-token",
		TimelineType: "bookmarks",
		MediaType:    "all",
		BatchSize:    20,
		Page:         1,
	})
	if err != nil {
		t.Fatalf("extractPrivateBookmarksTimeline returned error: %v", err)
	}
	if bookmarksRequests != 1 {
		t.Fatalf("expected 1 bookmarks request, got %d", bookmarksRequests)
	}
	if response.AccountInfo.Name != "bookmarks" || response.AccountInfo.Nick != "My Bookmarks" {
		t.Fatalf("unexpected account info: %#v", response.AccountInfo)
	}
	if response.Cursor != "bookmarks-live-cursor" || response.Completed {
		t.Fatalf("unexpected cursor/completed state: %#v", response.Metadata)
	}
	if len(response.Timeline) != 1 || response.Timeline[0].Type != "photo" {
		t.Fatalf("unexpected media timeline: %#v", response.Timeline)
	}
}

func TestExtractPrivateBookmarksTimelineMissingCoreReturnsFallback(t *testing.T) {
	client := newXAPITestClient(t, func(w http.ResponseWriter, r *http.Request) {
		if !strings.HasSuffix(r.URL.Path, xBookmarksPath) {
			t.Fatalf("unexpected request path %s", r.URL.Path)
		}
		writeJSONResponse(t, w, bookmarksTimelineEnvelope(
			timelineAddEntries(
				timelineDirectEntry("tweet-8951", xTweetResult{RestID: "8951"}),
			),
		))
	})

	_, err := client.extractPrivateBookmarksTimeline(context.Background(), TimelineRequest{
		AuthToken:    "auth-token",
		TimelineType: "bookmarks",
		MediaType:    "all",
	})
	if err == nil {
		t.Fatal("expected missing core fallback")
	}
	if !errors.Is(err, ErrEngineFallbackRequired) {
		t.Fatalf("expected fallback required error, got %v", err)
	}
	assertXFallback(t, err, "parse", "missing_core_user")
}

func TestFetchBookmarksPageMissingInstructionsReturnsFallback(t *testing.T) {
	session := newXAPITestSession(t, func(w http.ResponseWriter, r *http.Request) {
		writeJSONResponse(t, w, xBookmarksEnvelope{})
	})

	_, err := session.fetchBookmarksPage(context.Background(), 50, "")
	if err == nil {
		t.Fatal("expected missing instructions fallback")
	}
	if !errors.Is(err, ErrEngineFallbackRequired) {
		t.Fatalf("expected fallback required error, got %v", err)
	}
	assertXFallback(t, err, "fetch", "missing_instructions")
}

func bookmarksTimelineEnvelope(instructions ...xTimelineInstruction) xBookmarksEnvelope {
	var envelope xBookmarksEnvelope
	envelope.Data.BookmarkTimelineV2.Timeline.Instructions = instructions
	return envelope
}

func TestNewAuthenticatedSessionSeedsCSRFForBookmarksRequests(t *testing.T) {
	client := &xAPIClient{
		transport: &http.Transport{},
	}

	session, err := client.newAuthenticatedSession("auth-token")
	if err != nil {
		t.Fatalf("newAuthenticatedSession returned error: %v", err)
	}

	req, err := http.NewRequest(http.MethodGet, xRootURL, nil)
	if err != nil {
		t.Fatalf("new request: %v", err)
	}
	session.applyHeaders(req, true)
	if req.Header.Get("X-Csrf-Token") == "" {
		t.Fatal("expected csrf header to be present")
	}
}
