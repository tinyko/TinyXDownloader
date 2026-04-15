package backend

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

type xPublicSearchGoldenManifest struct {
	Cases []xPublicSearchGoldenCase `json:"cases"`
}

type xPublicSearchGoldenCase struct {
	Name             string                     `json:"name"`
	Request          DateRangeRequest           `json:"request"`
	UserLookup       *xUserByScreenNameEnvelope `json:"user_lookup,omitempty"`
	Pages            []xSearchTimelineEnvelope  `json:"pages"`
	ExpectedResponse *TwitterResponse           `json:"expected_response,omitempty"`
	ExpectedStage    string                     `json:"expected_stage,omitempty"`
	ExpectedCode     string                     `json:"expected_code,omitempty"`
	ExpectedQueries  []string                   `json:"expected_queries,omitempty"`
	ExpectedCursors  []string                   `json:"expected_cursors,omitempty"`
}

func TestXPublicSearchGoldenFixtures(t *testing.T) {
	manifest := loadXPublicSearchManifest(t, filepath.Join("testdata", "x_public_search", "cases.json"))

	for _, tt := range manifest.Cases {
		t.Run(tt.Name, func(t *testing.T) {
			searchRequests := 0
			var rawQueries []string
			var cursors []string

			client := newXAPITestClient(t, func(w http.ResponseWriter, r *http.Request) {
				switch {
				case strings.HasSuffix(r.URL.Path, xUserByScreenNamePath):
					if tt.UserLookup != nil {
						writeJSONResponse(t, w, tt.UserLookup)
					} else {
						writeJSONResponse(t, w, xUserByScreenNameEnvelope{})
					}
				case strings.HasSuffix(r.URL.Path, xSearchTimelinePath):
					searchRequests++
					if searchRequests > len(tt.Pages) {
						t.Fatalf("unexpected search page request %d", searchRequests)
					}
					variables := decodeVariables(t, r)
					rawQueries = append(rawQueries, asString(variables["rawQuery"]))
					cursors = append(cursors, asString(variables["cursor"]))
					writeJSONResponse(t, w, tt.Pages[searchRequests-1])
				default:
					t.Fatalf("unexpected request path %s", r.URL.Path)
				}
			})

			req := tt.Request
			if strings.TrimSpace(req.AuthToken) == "" {
				req.AuthToken = "auth-token"
			}

			response, err := client.extractPublicSearchDateRange(context.Background(), req)
			if tt.ExpectedStage != "" {
				assertXFallback(t, err, tt.ExpectedStage, tt.ExpectedCode)
				return
			}
			if err != nil {
				t.Fatalf("extractPublicSearchDateRange returned error: %v", err)
			}
			if tt.ExpectedResponse == nil {
				t.Fatal("expected response fixture")
			}
			if !reflect.DeepEqual(response, tt.ExpectedResponse) {
				gotJSON := marshalJSONForTest(t, response)
				wantJSON := marshalJSONForTest(t, tt.ExpectedResponse)
				t.Fatalf("unexpected response\nwant:\n%s\n\ngot:\n%s", wantJSON, gotJSON)
			}
			if len(tt.ExpectedQueries) > 0 && !reflect.DeepEqual(rawQueries, tt.ExpectedQueries) {
				t.Fatalf("unexpected raw queries: want=%#v got=%#v", tt.ExpectedQueries, rawQueries)
			}
			if len(tt.ExpectedCursors) > 0 && !reflect.DeepEqual(cursors, tt.ExpectedCursors) {
				t.Fatalf("unexpected cursor sequence: want=%#v got=%#v", tt.ExpectedCursors, cursors)
			}
		})
	}
}

func loadXPublicSearchManifest(t *testing.T, path string) xPublicSearchGoldenManifest {
	t.Helper()

	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read search fixture manifest %s: %v", path, err)
	}

	var manifest xPublicSearchGoldenManifest
	if err := json.Unmarshal(data, &manifest); err != nil {
		t.Fatalf("decode search fixture manifest %s: %v", path, err)
	}
	return manifest
}

func TestXPublicSearchGoldenManifestHasCases(t *testing.T) {
	manifest := loadXPublicSearchManifest(t, filepath.Join("testdata", "x_public_search", "cases.json"))
	if len(manifest.Cases) == 0 {
		t.Fatal("expected at least one search fixture case")
	}
}

func TestXPublicSearchFallbackErrorShape(t *testing.T) {
	client := newXAPITestClient(t, func(w http.ResponseWriter, r *http.Request) {
		switch {
		case strings.HasSuffix(r.URL.Path, xUserByScreenNamePath):
			var envelope xUserByScreenNameEnvelope
			envelope.Data.User.Result = fixtureXUser()
			writeJSONResponse(t, w, envelope)
		case strings.HasSuffix(r.URL.Path, xSearchTimelinePath):
			writeJSONResponse(t, w, searchTimelineEnvelope(
				timelineAddEntries(
					timelineDirectEntry("search-grid-0-tweet-9999", xTweetResult{
						RestID: "9999",
					}),
				),
			))
		default:
			t.Fatalf("unexpected request path %s", r.URL.Path)
		}
	})

	_, err := client.extractPublicSearchDateRange(context.Background(), DateRangeRequest{
		Username:    "example_user",
		AuthToken:   "auth-token",
		StartDate:   "2026-04-01",
		EndDate:     "2026-04-15",
		MediaFilter: "all",
	})
	if err == nil {
		t.Fatal("expected fallback error")
	}
	if !errors.Is(err, ErrEngineFallbackRequired) {
		t.Fatalf("expected fallback required, got %v", err)
	}
}
