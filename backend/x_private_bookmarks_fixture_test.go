package backend

import (
	"context"
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

type xPrivateBookmarksGoldenManifest struct {
	Cases []xPrivateBookmarksGoldenCase `json:"cases"`
}

type xPrivateBookmarksGoldenCase struct {
	Name             string              `json:"name"`
	Request          TimelineRequest     `json:"request"`
	Page             *xBookmarksEnvelope `json:"page,omitempty"`
	ExpectedResponse *TwitterResponse    `json:"expected_response,omitempty"`
	ExpectedStage    string              `json:"expected_stage,omitempty"`
	ExpectedCode     string              `json:"expected_code,omitempty"`
	ExpectedCursor   string              `json:"expected_cursor,omitempty"`
}

func TestXPrivateBookmarksGoldenFixtures(t *testing.T) {
	manifest := loadXPrivateBookmarksManifest(t, filepath.Join("testdata", "x_private_bookmarks", "cases.json"))

	for _, tt := range manifest.Cases {
		t.Run(tt.Name, func(t *testing.T) {
			var requestCursor string
			client := newXAPITestClient(t, func(w http.ResponseWriter, r *http.Request) {
				switch {
				case strings.HasSuffix(r.URL.Path, xBookmarksPath):
					variables := decodeVariables(t, r)
					requestCursor = asString(variables["cursor"])
					if tt.Page == nil {
						t.Fatal("expected bookmarks page fixture")
					}
					writeJSONResponse(t, w, tt.Page)
				default:
					t.Fatalf("unexpected request path %s", r.URL.Path)
				}
			})

			req := tt.Request
			if strings.TrimSpace(req.AuthToken) == "" {
				req.AuthToken = "auth-token"
			}

			response, err := client.extractPrivateBookmarksTimeline(context.Background(), req)
			if tt.ExpectedStage != "" {
				assertXFallback(t, err, tt.ExpectedStage, tt.ExpectedCode)
				return
			}
			if err != nil {
				t.Fatalf("extractPrivateBookmarksTimeline returned error: %v", err)
			}
			if tt.ExpectedResponse == nil {
				t.Fatal("expected response fixture")
			}
			if !reflect.DeepEqual(response, tt.ExpectedResponse) {
				gotJSON := marshalJSONForTest(t, response)
				wantJSON := marshalJSONForTest(t, tt.ExpectedResponse)
				t.Fatalf("unexpected response\nwant:\n%s\n\ngot:\n%s", wantJSON, gotJSON)
			}
			if requestCursor != tt.ExpectedCursor {
				t.Fatalf("unexpected request cursor: want=%q got=%q", tt.ExpectedCursor, requestCursor)
			}
		})
	}
}

func loadXPrivateBookmarksManifest(t *testing.T, path string) xPrivateBookmarksGoldenManifest {
	t.Helper()

	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read bookmarks fixture manifest %s: %v", path, err)
	}

	var manifest xPrivateBookmarksGoldenManifest
	if err := json.Unmarshal(data, &manifest); err != nil {
		t.Fatalf("decode bookmarks fixture manifest %s: %v", path, err)
	}
	return manifest
}

func TestXPrivateBookmarksGoldenManifestHasCases(t *testing.T) {
	manifest := loadXPrivateBookmarksManifest(t, filepath.Join("testdata", "x_private_bookmarks", "cases.json"))
	if len(manifest.Cases) == 0 {
		t.Fatal("expected at least one private bookmarks fixture case")
	}
}
