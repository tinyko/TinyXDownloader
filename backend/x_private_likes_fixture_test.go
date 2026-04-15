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

type xPrivateLikesGoldenManifest struct {
	Cases []xPrivateLikesGoldenCase `json:"cases"`
}

type xPrivateLikesGoldenCase struct {
	Name             string                     `json:"name"`
	Request          TimelineRequest           `json:"request"`
	UserLookup       *xUserByScreenNameEnvelope `json:"user_lookup,omitempty"`
	Page             *xUserMediaEnvelope       `json:"page,omitempty"`
	ExpectedResponse *TwitterResponse          `json:"expected_response,omitempty"`
	ExpectedStage    string                    `json:"expected_stage,omitempty"`
	ExpectedCode     string                    `json:"expected_code,omitempty"`
	ExpectedCursor   string                    `json:"expected_cursor,omitempty"`
}

func TestXPrivateLikesGoldenFixtures(t *testing.T) {
	manifest := loadXPrivateLikesManifest(t, filepath.Join("testdata", "x_private_likes", "cases.json"))

	for _, tt := range manifest.Cases {
		t.Run(tt.Name, func(t *testing.T) {
			var requestCursor string
			client := newXAPITestClient(t, func(w http.ResponseWriter, r *http.Request) {
				switch {
				case strings.HasSuffix(r.URL.Path, xUserByScreenNamePath):
					if tt.UserLookup != nil {
						writeJSONResponse(t, w, tt.UserLookup)
					} else {
						writeJSONResponse(t, w, xUserByScreenNameEnvelope{})
					}
				case strings.HasSuffix(r.URL.Path, xLikesPath):
					variables := decodeVariables(t, r)
					requestCursor = asString(variables["cursor"])
					if tt.Page == nil {
						t.Fatal("expected likes page fixture")
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

			response, err := client.extractPrivateLikesTimeline(context.Background(), req)
			if tt.ExpectedStage != "" {
				assertXFallback(t, err, tt.ExpectedStage, tt.ExpectedCode)
				return
			}
			if err != nil {
				t.Fatalf("extractPrivateLikesTimeline returned error: %v", err)
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

func loadXPrivateLikesManifest(t *testing.T, path string) xPrivateLikesGoldenManifest {
	t.Helper()

	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read likes fixture manifest %s: %v", path, err)
	}

	var manifest xPrivateLikesGoldenManifest
	if err := json.Unmarshal(data, &manifest); err != nil {
		t.Fatalf("decode likes fixture manifest %s: %v", path, err)
	}
	return manifest
}

func TestXPrivateLikesGoldenManifestHasCases(t *testing.T) {
	manifest := loadXPrivateLikesManifest(t, filepath.Join("testdata", "x_private_likes", "cases.json"))
	if len(manifest.Cases) == 0 {
		t.Fatal("expected at least one private likes fixture case")
	}
}
