package backend

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"testing"
)

type xPublicMediaGoldenCase struct {
	name              string
	dir               string
	mediaType         string
	page              int
	pageFile          string
	expectedFile      string
	expectedStage     string
	expectedCode      string
	expectedPageItems int
	expectedMedia     int
	expectedCursor    bool
}

func TestXPublicMediaGoldenFixtures(t *testing.T) {
	fixtureRoot := filepath.Join("testdata", "x_public_media")

	tests := []xPublicMediaGoldenCase{
		{
			name:              "photo-only",
			dir:               "photo-only",
			mediaType:         "image",
			page:              1,
			pageFile:          "user_media_page1.json",
			expectedFile:      "expected_response_page1.json",
			expectedPageItems: 1,
			expectedMedia:     1,
			expectedCursor:    true,
		},
		{
			name:              "video-only",
			dir:               "video-only",
			mediaType:         "video",
			page:              1,
			pageFile:          "user_media_page1.json",
			expectedFile:      "expected_response_page1.json",
			expectedPageItems: 1,
			expectedMedia:     1,
			expectedCursor:    true,
		},
		{
			name:              "gif-only",
			dir:               "gif-only",
			mediaType:         "gif",
			page:              1,
			pageFile:          "user_media_page1.json",
			expectedFile:      "expected_response_page1.json",
			expectedPageItems: 1,
			expectedMedia:     1,
			expectedCursor:    true,
		},
		{
			name:              "mixed-media",
			dir:               "mixed-media",
			mediaType:         "all",
			page:              1,
			pageFile:          "user_media_page1.json",
			expectedFile:      "expected_response_page1.json",
			expectedPageItems: 3,
			expectedMedia:     3,
			expectedCursor:    true,
		},
		{
			name:              "empty-result",
			dir:               "empty-result",
			mediaType:         "all",
			page:              1,
			pageFile:          "user_media_page1.json",
			expectedFile:      "expected_response_page1.json",
			expectedPageItems: 0,
			expectedMedia:     0,
			expectedCursor:    false,
		},
		{
			name:              "promoted-noise",
			dir:               "promoted-noise",
			mediaType:         "all",
			page:              1,
			pageFile:          "user_media_page1.json",
			expectedFile:      "expected_response_page1.json",
			expectedPageItems: 0,
			expectedMedia:     0,
			expectedCursor:    false,
		},
		{
			name:              "duplicate-media",
			dir:               "duplicate-media",
			mediaType:         "all",
			page:              1,
			pageFile:          "user_media_page1.json",
			expectedFile:      "expected_response_page1.json",
			expectedPageItems: 2,
			expectedMedia:     1,
			expectedCursor:    true,
		},
		{
			name:              "multi-page-continuation page1",
			dir:               "multi-page-continuation",
			mediaType:         "all",
			page:              1,
			pageFile:          "user_media_page1.json",
			expectedFile:      "expected_response_page1.json",
			expectedPageItems: 1,
			expectedMedia:     1,
			expectedCursor:    true,
		},
		{
			name:              "multi-page-continuation page2",
			dir:               "multi-page-continuation",
			mediaType:         "all",
			page:              2,
			pageFile:          "user_media_page2.json",
			expectedFile:      "expected_response_page2.json",
			expectedPageItems: 1,
			expectedMedia:     1,
			expectedCursor:    true,
		},
		{
			name:          "missing-core",
			dir:           "missing-core",
			mediaType:     "all",
			page:          1,
			pageFile:      "user_media_page1.json",
			expectedStage: "parse",
			expectedCode:  "missing_core_user",
		},
		{
			name:              "missing-cursor",
			dir:               "missing-cursor",
			mediaType:         "all",
			page:              1,
			pageFile:          "user_media_page1.json",
			expectedStage:     "normalize",
			expectedCode:      "missing_cursor",
			expectedPageItems: 1,
			expectedMedia:     1,
			expectedCursor:    false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			caseDir := filepath.Join(fixtureRoot, tt.dir)
			user := loadXUserFixture(t, filepath.Join(caseDir, "user_lookup.json"))
			envelope := loadXUserMediaFixture(t, filepath.Join(caseDir, tt.pageFile))

			parsed, err := parseXMediaTimelinePage(envelope, tt.mediaType)
			if tt.expectedStage == "parse" {
				assertXFallback(t, err, tt.expectedStage, tt.expectedCode)
				return
			}
			if err != nil {
				t.Fatalf("parseXMediaTimelinePage returned error: %v", err)
			}
			if parsed.RawItemCount != tt.expectedPageItems {
				t.Fatalf("expected page item count %d, got %d", tt.expectedPageItems, parsed.RawItemCount)
			}
			if len(parsed.Items) != tt.expectedMedia {
				t.Fatalf("expected media item count %d, got %d", tt.expectedMedia, len(parsed.Items))
			}
			if got := parsed.Cursor != ""; got != tt.expectedCursor {
				t.Fatalf("expected cursor present=%t, got %t", tt.expectedCursor, got)
			}

			response, err := buildPublicMediaTimelineResponseFromParsed(
				TimelineRequest{
					Username:  "example_user",
					BatchSize: 20,
					Page:      tt.page,
					MediaType: tt.mediaType,
				},
				user,
				parsed,
			)
			if tt.expectedStage == "normalize" {
				assertXFallback(t, err, tt.expectedStage, tt.expectedCode)
				return
			}
			if err != nil {
				t.Fatalf("buildPublicMediaTimelineResponseFromParsed returned error: %v", err)
			}

			expected := loadTwitterResponseFixture(t, filepath.Join(caseDir, tt.expectedFile))
			if !reflect.DeepEqual(response, expected) {
				gotJSON := marshalJSONForTest(t, response)
				wantJSON := marshalJSONForTest(t, expected)
				t.Fatalf("unexpected response\nwant:\n%s\n\ngot:\n%s", wantJSON, gotJSON)
			}
		})
	}
}

func loadXUserFixture(t *testing.T, path string) xUserResult {
	t.Helper()

	var envelope xUserByScreenNameEnvelope
	loadJSONFixture(t, path, &envelope)
	user, err := xResolveUserLookupResult(envelope)
	if err != nil {
		t.Fatalf("resolve user fixture %s: %v", path, err)
	}
	return user
}

func loadXUserMediaFixture(t *testing.T, path string) *xUserMediaEnvelope {
	t.Helper()

	var envelope xUserMediaEnvelope
	loadJSONFixture(t, path, &envelope)
	return &envelope
}

func loadTwitterResponseFixture(t *testing.T, path string) *TwitterResponse {
	t.Helper()

	var response TwitterResponse
	loadJSONFixture(t, path, &response)
	return &response
}

func loadJSONFixture(t *testing.T, path string, out any) {
	t.Helper()

	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read fixture %s: %v", path, err)
	}
	if err := json.Unmarshal(data, out); err != nil {
		t.Fatalf("decode fixture %s: %v", path, err)
	}
}

func marshalJSONForTest(t *testing.T, value any) string {
	t.Helper()

	data, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		t.Fatalf("marshal test json: %v", err)
	}
	return string(data)
}

func assertXFallback(t *testing.T, err error, stage string, code string) {
	t.Helper()

	if err == nil {
		t.Fatal("expected fallback error")
	}
	if !errors.Is(err, ErrEngineFallbackRequired) {
		t.Fatalf("expected fallback required, got %v", err)
	}
	metadata, ok := xFallbackDetails(err)
	if !ok {
		t.Fatal("expected fallback metadata")
	}
	if metadata.Stage != stage || metadata.Code != code {
		t.Fatalf("unexpected fallback metadata: %+v", metadata)
	}
}
