package backend

import (
	"context"
	"crypto/tls"
	"net"
	"net/http"
	"net/http/httptest"
	neturl "net/url"
	"strings"
	"testing"
	"time"
)

func TestGoTwitterEngineDateRangeSupportPhase2B(t *testing.T) {
	engine := &GoTwitterEngine{}

	tests := []struct {
		name   string
		req    DateRangeRequest
		ok     bool
		reason string
	}{
		{
			name: "all supported",
			req: DateRangeRequest{
				Username:    "example",
				StartDate:   "2026-04-01",
				EndDate:     "2026-04-15",
				MediaFilter: "all",
			},
			ok: true,
		},
		{
			name: "text supported",
			req: DateRangeRequest{
				Username:    "example",
				StartDate:   "2026-04-01",
				EndDate:     "2026-04-15",
				MediaFilter: "text",
			},
			ok: true,
		},
		{
			name: "gif supported",
			req: DateRangeRequest{
				Username:    "example",
				StartDate:   "2026-04-01",
				EndDate:     "2026-04-15",
				MediaFilter: "gif",
			},
			ok: true,
		},
		{
			name: "invalid filter unsupported",
			req: DateRangeRequest{
				Username:    "example",
				StartDate:   "2026-04-01",
				EndDate:     "2026-04-15",
				MediaFilter: "audio",
			},
			reason: "all|image|video|gif|text",
		},
		{
			name: "raw search unsupported",
			req: DateRangeRequest{
				Username:    "https://x.com/search?q=from%3Aexample",
				StartDate:   "2026-04-01",
				EndDate:     "2026-04-15",
				MediaFilter: "all",
			},
			reason: "username-based",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			ok, reason := engine.DateRangeSupport(tt.req)
			if ok != tt.ok {
				t.Fatalf("expected ok=%t, got %t (reason=%q)", tt.ok, ok, reason)
			}
			if tt.reason != "" && !containsInsensitive(reason, tt.reason) {
				t.Fatalf("expected reason to contain %q, got %q", tt.reason, reason)
			}
		})
	}
}

func TestXBuildPublicDateRangeQueryMatchesBuildSearchURL(t *testing.T) {
	tests := []DateRangeRequest{
		{Username: "example_user", StartDate: "2026-04-01", EndDate: "2026-04-15", MediaFilter: "all"},
		{Username: "example_user", StartDate: "2026-04-01", EndDate: "2026-04-15", MediaFilter: "image"},
		{Username: "example_user", StartDate: "2026-04-01", EndDate: "2026-04-15", MediaFilter: "video"},
		{Username: "example_user", StartDate: "2026-04-01", EndDate: "2026-04-15", MediaFilter: "gif"},
		{Username: "example_user", StartDate: "2026-04-01", EndDate: "2026-04-15", MediaFilter: "text"},
		{Username: "example_user", StartDate: "2026-04-01", EndDate: "2026-04-15", MediaFilter: "all", Retweets: true},
	}

	for _, req := range tests {
		t.Run(req.MediaFilter+"-"+boolLabel(req.Retweets), func(t *testing.T) {
			query, err := xBuildPublicDateRangeQuery(req)
			if err != nil {
				t.Fatalf("xBuildPublicDateRangeQuery returned error: %v", err)
			}

			searchURL := buildSearchURL(req.Username, req.StartDate, req.EndDate, req.MediaFilter, req.Retweets)
			parsed, err := neturl.Parse(searchURL)
			if err != nil {
				t.Fatalf("parse search url: %v", err)
			}
			want := parsed.Query().Get("q")
			want, err = neturl.QueryUnescape(want)
			if err != nil {
				t.Fatalf("unescape search url query: %v", err)
			}
			if query != want {
				t.Fatalf("expected %q, got %q", want, query)
			}
		})
	}
}

func TestXBuildPublicDateRangeQueryRejectsRawSearch(t *testing.T) {
	_, err := xBuildPublicDateRangeQuery(DateRangeRequest{
		Username:    "https://x.com/search?q=from%3Aexample_user",
		StartDate:   "2026-04-01",
		EndDate:     "2026-04-15",
		MediaFilter: "all",
	})
	if err == nil {
		t.Fatal("expected raw search to be unsupported")
	}
	if !containsInsensitive(err.Error(), "username-based") {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestXAdvanceSearchTimelinePagination(t *testing.T) {
	t.Run("uses max id when available", func(t *testing.T) {
		query, cursor := xAdvanceSearchTimelinePagination("from:example_user filter:media", "cursor-1", "7002")
		if cursor != "" {
			t.Fatalf("expected empty cursor, got %q", cursor)
		}
		if query != "from:example_user filter:media max_id:7001" {
			t.Fatalf("unexpected query: %q", query)
		}
	})

	t.Run("replaces existing max id", func(t *testing.T) {
		query, cursor := xAdvanceSearchTimelinePagination("from:example_user filter:media max_id:9999", "cursor-1", "7002")
		if cursor != "" {
			t.Fatalf("expected empty cursor, got %q", cursor)
		}
		if query != "from:example_user filter:media max_id:7001" {
			t.Fatalf("unexpected query: %q", query)
		}
	})

	t.Run("falls back to cursor", func(t *testing.T) {
		query, cursor := xAdvanceSearchTimelinePagination("from:example_user filter:media", "cursor-2", "")
		if query != "from:example_user filter:media" {
			t.Fatalf("unexpected query: %q", query)
		}
		if cursor != "cursor-2" {
			t.Fatalf("expected cursor fallback, got %q", cursor)
		}
	})
}

func TestFetchSearchTimelineAllUsesMaxIDPagination(t *testing.T) {
	user := timelineTestUser("example_user", "Example Display", "7200")
	firstTweet := timelineTestTweet("7202", user, "First result", timelinePhotoEntity("https://pbs.twimg.com/media/search-page-1.jpg", 1200, 800))
	secondTweet := timelineTestTweet("7199", user, "Second result", timelinePhotoEntity("https://pbs.twimg.com/media/search-page-2.jpg", 1200, 800))

	var rawQueries []string
	var cursors []string
	page := 0
	session := newXAPITestSession(t, func(w http.ResponseWriter, r *http.Request) {
		if !strings.HasSuffix(r.URL.Path, xSearchTimelinePath) {
			t.Fatalf("unexpected request path %s", r.URL.Path)
		}
		variables := decodeVariables(t, r)
		rawQueries = append(rawQueries, asString(variables["rawQuery"]))
		cursors = append(cursors, asString(variables["cursor"]))
		page++
		switch page {
		case 1:
			writeJSONResponse(t, w, searchTimelineEnvelope(
				timelineAddEntries(
					timelineDirectEntry("search-grid-0-tweet-7202", firstTweet),
					timelineCursorEntry("cursor-bottom-1", "cursor-search-1"),
				),
			))
		case 2:
			writeJSONResponse(t, w, searchTimelineEnvelope(
				timelineAddEntries(
					timelineDirectEntry("search-grid-1-tweet-7199", secondTweet),
				),
			))
		default:
			t.Fatalf("unexpected page request %d", page)
		}
	})

	parsed, pageCount, err := session.fetchSearchTimelineAll(
		context.Background(),
		"from:example_user since:2026-04-01 until:2026-04-15 filter:media -filter:retweets",
		xDateRangeSearchCount,
		xTimelineParseOptions{Filter: "all"},
	)
	if err != nil {
		t.Fatalf("fetchSearchTimelineAll returned error: %v", err)
	}
	if pageCount != 2 {
		t.Fatalf("expected 2 pages, got %d", pageCount)
	}
	if parsed.RawTweetCount != 2 || len(parsed.Media) != 2 {
		t.Fatalf("unexpected parsed result: %+v", parsed)
	}
	if len(rawQueries) != 2 {
		t.Fatalf("expected 2 queries, got %d", len(rawQueries))
	}
	if rawQueries[0] != "from:example_user since:2026-04-01 until:2026-04-15 filter:media -filter:retweets" {
		t.Fatalf("unexpected initial query: %q", rawQueries[0])
	}
	if rawQueries[1] != "from:example_user since:2026-04-01 until:2026-04-15 filter:media -filter:retweets max_id:7201" {
		t.Fatalf("unexpected max_id query: %q", rawQueries[1])
	}
	if cursors[0] != "" || cursors[1] != "" {
		t.Fatalf("expected max_id pagination without cursor reuse, got %#v", cursors)
	}
}

func TestFetchSearchTimelineAllFallsBackToCursorPagination(t *testing.T) {
	user := timelineTestUser("example_user", "Example Display", "7300")
	searchTweet := timelineTestTweet("7301", user, "Cursor fallback result", timelinePhotoEntity("https://pbs.twimg.com/media/search-fallback.jpg", 1200, 800))

	var rawQueries []string
	var cursors []string
	page := 0
	session := newXAPITestSession(t, func(w http.ResponseWriter, r *http.Request) {
		if !strings.HasSuffix(r.URL.Path, xSearchTimelinePath) {
			t.Fatalf("unexpected request path %s", r.URL.Path)
		}
		variables := decodeVariables(t, r)
		rawQueries = append(rawQueries, asString(variables["rawQuery"]))
		cursors = append(cursors, asString(variables["cursor"]))
		page++
		switch page {
		case 1:
			writeJSONResponse(t, w, searchTimelineEnvelope(
				timelineAddEntries(
					timelineCursorEntry("cursor-bottom-1", "cursor-fallback-1"),
				),
			))
		case 2:
			writeJSONResponse(t, w, searchTimelineEnvelope(
				timelineAddEntries(
					timelineDirectEntry("search-grid-0-tweet-7301", searchTweet),
				),
			))
		default:
			t.Fatalf("unexpected page request %d", page)
		}
	})

	parsed, pageCount, err := session.fetchSearchTimelineAll(
		context.Background(),
		"from:example_user since:2026-04-01 until:2026-04-15 filter:media -filter:retweets",
		xDateRangeSearchCount,
		xTimelineParseOptions{Filter: "all"},
	)
	if err != nil {
		t.Fatalf("fetchSearchTimelineAll returned error: %v", err)
	}
	if pageCount != 2 {
		t.Fatalf("expected 2 pages, got %d", pageCount)
	}
	if parsed.RawTweetCount != 1 || len(parsed.Media) != 1 {
		t.Fatalf("unexpected parsed result: %+v", parsed)
	}
	if rawQueries[0] != rawQueries[1] {
		t.Fatalf("expected raw query reuse on cursor fallback, got %#v", rawQueries)
	}
	if cursors[0] != "" || cursors[1] != "cursor-fallback-1" {
		t.Fatalf("unexpected cursor sequence: %#v", cursors)
	}
}

func TestExtractPublicSearchDateRangeBestEffortLookup(t *testing.T) {
	user := timelineTestUser("example_user", "Example Display", "7400")
	textTweet := timelineTestTweet("7401", user, "Search text result")

	client := newXAPITestClient(t, func(w http.ResponseWriter, r *http.Request) {
		switch {
		case strings.HasSuffix(r.URL.Path, xUserByScreenNamePath):
			writeJSONResponse(t, w, xUserByScreenNameEnvelope{})
		case strings.HasSuffix(r.URL.Path, xSearchTimelinePath):
			writeJSONResponse(t, w, searchTimelineEnvelope(
				timelineAddEntries(
					timelineDirectEntry("search-grid-0-tweet-7401", textTweet),
				),
			))
		default:
			t.Fatalf("unexpected request path %s", r.URL.Path)
		}
	})

	response, err := client.extractPublicSearchDateRange(context.Background(), DateRangeRequest{
		Username:    "example_user",
		AuthToken:   "auth-token",
		StartDate:   "2026-04-01",
		EndDate:     "2026-04-15",
		MediaFilter: "text",
	})
	if err != nil {
		t.Fatalf("extractPublicSearchDateRange returned error: %v", err)
	}
	if response.AccountInfo.Name != "example_user" || response.AccountInfo.Nick != "example_user" {
		t.Fatalf("expected placeholder account info, got %#v", response.AccountInfo)
	}
	if !response.Completed || response.Cursor != "" {
		t.Fatalf("expected completed response with empty cursor, got %#v", response.Metadata)
	}
	if len(response.Timeline) != 1 || response.Timeline[0].Type != "text" {
		t.Fatalf("unexpected timeline: %#v", response.Timeline)
	}
}

func TestExtractPublicSearchDateRangeLookupEnrichesAccountInfo(t *testing.T) {
	user := timelineTestUser("example_user", "Example Display", "7500")
	photoTweet := timelineTestTweet("7501", user, "Search media result", timelinePhotoEntity("https://pbs.twimg.com/media/search-media.jpg", 1200, 800))

	client := newXAPITestClient(t, func(w http.ResponseWriter, r *http.Request) {
		switch {
		case strings.HasSuffix(r.URL.Path, xUserByScreenNamePath):
			var envelope xUserByScreenNameEnvelope
			envelope.Data.User.Result = user
			writeJSONResponse(t, w, envelope)
		case strings.HasSuffix(r.URL.Path, xSearchTimelinePath):
			writeJSONResponse(t, w, searchTimelineEnvelope(
				timelineAddEntries(
					timelineDirectEntry("search-grid-0-tweet-7501", photoTweet),
				),
			))
		default:
			t.Fatalf("unexpected request path %s", r.URL.Path)
		}
	})

	response, err := client.extractPublicSearchDateRange(context.Background(), DateRangeRequest{
		Username:    "example_user",
		AuthToken:   "auth-token",
		StartDate:   "2026-04-01",
		EndDate:     "2026-04-15",
		MediaFilter: "all",
	})
	if err != nil {
		t.Fatalf("extractPublicSearchDateRange returned error: %v", err)
	}
	if response.AccountInfo.Name != "example_user" || response.AccountInfo.Nick != "Example Display" {
		t.Fatalf("unexpected account info: %#v", response.AccountInfo)
	}
	if response.AccountInfo.ProfileImage == "" || response.AccountInfo.FollowersCount == 0 {
		t.Fatalf("expected enriched account info, got %#v", response.AccountInfo)
	}
	if len(response.Timeline) != 1 || response.Timeline[0].Type != "photo" {
		t.Fatalf("unexpected timeline: %#v", response.Timeline)
	}
}

func newXAPITestClient(t *testing.T, handler http.HandlerFunc) *xAPIClient {
	t.Helper()

	server := httptest.NewTLSServer(handler)
	t.Cleanup(server.Close)

	targetAddr := server.Listener.Addr().String()

	baseTransport, ok := server.Client().Transport.(*http.Transport)
	if !ok {
		t.Fatal("expected test server client transport to be *http.Transport")
	}
	transport := baseTransport.Clone()
	transport.TLSClientConfig = &tls.Config{InsecureSkipVerify: true}
	transport.DialContext = func(ctx context.Context, network string, addr string) (net.Conn, error) {
		dialer := &net.Dialer{}
		return dialer.DialContext(ctx, network, targetAddr)
	}

	return &xAPIClient{
		transport: transport,
		timeout:   5 * time.Second,
	}
}

func asString(value any) string {
	if value == nil {
		return ""
	}
	if typed, ok := value.(string); ok {
		return typed
	}
	return ""
}

func boolLabel(value bool) string {
	if value {
		return "retweets"
	}
	return "no-retweets"
}
