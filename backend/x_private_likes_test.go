package backend

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"testing"
	"time"
)

func TestNewAuthenticatedSessionRejectsMissingAuthToken(t *testing.T) {
	client := &xAPIClient{
		transport: &http.Transport{},
		timeout:   time.Second,
	}

	_, err := client.newAuthenticatedSession("")
	if err == nil {
		t.Fatal("expected missing auth token fallback")
	}
	assertXFallback(t, err, "lookup", "missing_auth_token")
}

func TestNewAuthenticatedSessionSeedsAuthCookiesAndCSRFHeader(t *testing.T) {
	client := &xAPIClient{
		transport: &http.Transport{},
		timeout:   time.Second,
	}

	session, err := client.newAuthenticatedSession("auth-token")
	if err != nil {
		t.Fatalf("newAuthenticatedSession returned error: %v", err)
	}

	csrfToken := session.currentCSRFToken()
	if len(csrfToken) != 32 {
		t.Fatalf("expected 32 character csrf token, got %q", csrfToken)
	}

	req, err := http.NewRequest(http.MethodGet, xRootURL, nil)
	if err != nil {
		t.Fatalf("new request: %v", err)
	}
	session.applyHeaders(req, true)
	if got := req.Header.Get("X-Csrf-Token"); got != csrfToken {
		t.Fatalf("expected csrf header %q, got %q", csrfToken, got)
	}
	if got := req.Header.Get("X-Twitter-Auth-Type"); got != "OAuth2Session" {
		t.Fatalf("expected OAuth2Session auth header, got %q", got)
	}
}

func TestFetchLikesPageUsesLikesPathAndRawCursor(t *testing.T) {
	user := timelineTestUser("likes_user", "Likes User", "8100")
	textTweet := timelineTestTweet("8101", user, "Liked tweet")
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
				timelineDirectEntry("tweet-8101", textTweet),
				timelineCursorEntry("cursor-bottom-1", "likes-cursor-1"),
			),
		))
	})

	page, err := session.fetchLikesPage(context.Background(), user.RestID, 50, "raw-likes-cursor")
	if err != nil {
		t.Fatalf("fetchLikesPage returned error: %v", err)
	}
	if !strings.HasSuffix(capturedPath, xLikesPath) {
		t.Fatalf("expected path suffix %s, got %s", xLikesPath, capturedPath)
	}
	if capturedCursor != "raw-likes-cursor" {
		t.Fatalf("expected raw likes cursor, got %q", capturedCursor)
	}
	if len(page.Data.User.Result.Timeline.Timeline.Instructions) == 0 {
		t.Fatal("expected likes timeline instructions")
	}
}

func TestBuildPrivateLikesTimelineResponseUsesMyLikesAccountInfo(t *testing.T) {
	user := timelineTestUser("likes_user", "Likes User", "8200")
	photoTweet := timelineTestTweet("8201", user, "Liked photo", timelinePhotoEntity("https://pbs.twimg.com/media/private-likes-photo.jpg", 1600, 900))

	parsed, err := parseXTimelinePage([]xTimelineInstruction{
		timelineAddEntries(
			timelineDirectEntry("tweet-8201", photoTweet),
			timelineCursorEntry("cursor-bottom-1", "likes-page-1"),
		),
	}, xTimelineParseOptions{Filter: "all"})
	if err != nil {
		t.Fatalf("parseXTimelinePage returned error: %v", err)
	}

	response, err := buildPrivateLikesTimelineResponseFromParsed(TimelineRequest{
		Username:     "likes_user",
		TimelineType: "likes",
		MediaType:    "all",
		BatchSize:    20,
		Page:         1,
	}, user, parsed)
	if err != nil {
		t.Fatalf("buildPrivateLikesTimelineResponseFromParsed returned error: %v", err)
	}

	if response.AccountInfo.Name != "likes" || response.AccountInfo.Nick != "My Likes" {
		t.Fatalf("unexpected likes account info names: %#v", response.AccountInfo)
	}
	if response.AccountInfo.ProfileImage == "" || response.AccountInfo.FollowersCount == 0 {
		t.Fatalf("expected enriched account info, got %#v", response.AccountInfo)
	}
	if response.Cursor != "likes-page-1" || response.Completed {
		t.Fatalf("unexpected continuation state: cursor=%q completed=%t", response.Cursor, response.Completed)
	}
	if len(response.Timeline) != 1 || response.Timeline[0].AuthorUsername != "likes_user" {
		t.Fatalf("unexpected timeline response: %#v", response.Timeline)
	}
}

func TestBuildPrivateLikesTimelineResponseTextOnlyExcludesMediaTweets(t *testing.T) {
	user := timelineTestUser("likes_user", "Likes User", "8300")
	photoTweet := timelineTestTweet("8301", user, "Liked photo", timelinePhotoEntity("https://pbs.twimg.com/media/private-likes-text-photo.jpg", 1200, 800))
	textTweet := timelineTestTweet("8302", user, "Liked text only")

	parsed, err := parseXTimelinePage([]xTimelineInstruction{
		timelineAddEntries(
			timelineDirectEntry("tweet-8301", photoTweet),
			timelineDirectEntry("tweet-8302", textTweet),
			timelineCursorEntry("cursor-bottom-1", "likes-text-cursor"),
		),
	}, xTimelineParseOptions{Filter: "all", TextOnly: true})
	if err != nil {
		t.Fatalf("parseXTimelinePage returned error: %v", err)
	}

	response, err := buildPrivateLikesTimelineResponseFromParsed(TimelineRequest{
		Username:     "likes_user",
		TimelineType: "likes",
		MediaType:    "text",
		BatchSize:    20,
		Page:         1,
	}, user, parsed)
	if err != nil {
		t.Fatalf("buildPrivateLikesTimelineResponseFromParsed returned error: %v", err)
	}
	if len(response.Timeline) != 1 {
		t.Fatalf("expected 1 text-only entry, got %d", len(response.Timeline))
	}
	if response.Timeline[0].TweetID != TweetIDString(8302) || response.Timeline[0].Type != "text" {
		t.Fatalf("unexpected text-only entry: %#v", response.Timeline[0])
	}
}

func TestExtractPrivateLikesTimelineMissingUsernameReturnsFallback(t *testing.T) {
	client := &xAPIClient{}

	_, err := client.extractPrivateLikesTimeline(context.Background(), TimelineRequest{
		Username:     "likes",
		AuthToken:    "auth-token",
		TimelineType: "likes",
		MediaType:    "all",
	})
	if err == nil {
		t.Fatal("expected missing username fallback")
	}
	assertXFallback(t, err, "lookup", "missing_likes_username")
}

func TestExtractPrivateLikesTimelineIntegration(t *testing.T) {
	user := timelineTestUser("likes_user", "Likes User", "8400")
	photoTweet := timelineTestTweet("8401", user, "Liked media", timelinePhotoEntity("https://pbs.twimg.com/media/private-likes-int-photo.jpg", 1400, 900))
	textTweet := timelineTestTweet("8402", user, "Liked text")
	lookupRequests := 0
	likesRequests := 0

	client := newXAPITestClient(t, func(w http.ResponseWriter, r *http.Request) {
		switch {
		case strings.HasSuffix(r.URL.Path, xUserByScreenNamePath):
			lookupRequests++
			var envelope xUserByScreenNameEnvelope
			envelope.Data.User.Result = user
			writeJSONResponse(t, w, envelope)
		case strings.HasSuffix(r.URL.Path, xLikesPath):
			likesRequests++
			writeJSONResponse(t, w, userTimelineEnvelope(
				timelineAddEntries(
					timelineDirectEntry("tweet-8401", photoTweet),
					timelineDirectEntry("tweet-8402", textTweet),
					timelineCursorEntry("cursor-bottom-1", "likes-live-cursor"),
				),
			))
		default:
			t.Fatalf("unexpected request path %s", r.URL.Path)
		}
	})

	response, err := client.extractPrivateLikesTimeline(context.Background(), TimelineRequest{
		Username:     "likes_user",
		AuthToken:    "auth-token",
		TimelineType: "likes",
		MediaType:    "all",
		BatchSize:    20,
		Page:         1,
	})
	if err != nil {
		t.Fatalf("extractPrivateLikesTimeline returned error: %v", err)
	}
	if lookupRequests != 1 || likesRequests != 1 {
		t.Fatalf("unexpected request counts: lookup=%d likes=%d", lookupRequests, likesRequests)
	}
	if response.AccountInfo.Name != "likes" || response.AccountInfo.Nick != "My Likes" {
		t.Fatalf("unexpected account info: %#v", response.AccountInfo)
	}
	if response.Cursor != "likes-live-cursor" || response.Completed {
		t.Fatalf("unexpected cursor/completed state: %#v", response.Metadata)
	}
	if len(response.Timeline) != 1 || response.Timeline[0].Type != "photo" {
		t.Fatalf("unexpected media timeline: %#v", response.Timeline)
	}
}

func TestExtractPrivateLikesTimelineMissingCoreReturnsFallback(t *testing.T) {
	user := timelineTestUser("likes_user", "Likes User", "8500")

	client := newXAPITestClient(t, func(w http.ResponseWriter, r *http.Request) {
		switch {
		case strings.HasSuffix(r.URL.Path, xUserByScreenNamePath):
			var envelope xUserByScreenNameEnvelope
			envelope.Data.User.Result = user
			writeJSONResponse(t, w, envelope)
		case strings.HasSuffix(r.URL.Path, xLikesPath):
			writeJSONResponse(t, w, userTimelineEnvelope(
				timelineAddEntries(
					timelineDirectEntry("tweet-8501", xTweetResult{RestID: "8501"}),
				),
			))
		default:
			t.Fatalf("unexpected request path %s", r.URL.Path)
		}
	})

	_, err := client.extractPrivateLikesTimeline(context.Background(), TimelineRequest{
		Username:     "likes_user",
		AuthToken:    "auth-token",
		TimelineType: "likes",
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
