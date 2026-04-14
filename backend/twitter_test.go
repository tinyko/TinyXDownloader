package backend

import "testing"

func TestCancelExtractorRequestInvokesRegisteredCancel(t *testing.T) {
	canceled := false
	cleanup := registerExtractorRequest("request-1", func() {
		canceled = true
	})
	defer cleanup()

	if !CancelExtractorRequest("request-1") {
		t.Fatalf("expected registered request to be canceled")
	}

	if !canceled {
		t.Fatalf("expected registered cancel function to be invoked")
	}

	if !consumeExtractorRequestCanceled("request-1") {
		t.Fatalf("expected canceled request to be tracked")
	}

	if CancelExtractorRequest("request-1") {
		t.Fatalf("expected request cancellation to be idempotent after removal")
	}
}

func TestCancelExtractorRequestRejectsBlankIDs(t *testing.T) {
	if CancelExtractorRequest("") {
		t.Fatalf("expected blank request id to be ignored")
	}
}

func TestExtractJSONHandlesValidJSONWithBracesInStrings(t *testing.T) {
	output := `{"media":[{"content":"daily {125p-200p} upload","note":"link in comments {↓}"}],"metadata":[],"completed":false}`

	jsonStr := extractJSON(output)
	if jsonStr != output {
		t.Fatalf("expected full JSON to be extracted, got %q", jsonStr)
	}
}

func TestExtractJSONFindsJSONAmidLogNoise(t *testing.T) {
	output := "[info] starting extractor\n{\"media\":[{\"content\":\"extra arts {↓}\"}],\"metadata\":[],\"completed\":false}\n[info] done"

	jsonStr := extractJSON(output)
	expected := "{\"media\":[{\"content\":\"extra arts {↓}\"}],\"metadata\":[],\"completed\":false}"
	if jsonStr != expected {
		t.Fatalf("expected JSON payload to be extracted, got %q", jsonStr)
	}
}

func TestBuildTimelineEntriesFromCLIResponseKeepsTextAndMediaPathsStable(t *testing.T) {
	response := &CLIResponse{
		Media: []CLIMediaItem{
			{
				URL:     "https://example.com/media.jpg",
				Date:    "2026-04-15T08:00:00",
				TweetID: 1001,
				Type:    "photo",
			},
		},
		Metadata: []TweetMetadata{
			{
				TweetID: 1001,
				Content: "photo tweet",
				Author: Author{
					Name: "media_author",
					Nick: "Media Author",
				},
			},
			{
				TweetID: 1002,
				Content: "plain text tweet",
				Author: Author{
					Name: "text_author",
					Nick: "Text Author",
				},
			},
		},
	}

	mediaTimeline := buildTimelineEntriesFromCLIResponse(response, false)
	if len(mediaTimeline) != 1 || mediaTimeline[0].TweetID != TweetIDString(1001) {
		t.Fatalf("expected media-only path to keep only media entry, got %+v", mediaTimeline)
	}

	textTimeline := buildTimelineEntriesFromCLIResponse(response, true)
	if len(textTimeline) != 1 || textTimeline[0].TweetID != TweetIDString(1002) {
		t.Fatalf("expected text-only path to keep non-media metadata entry, got %+v", textTimeline)
	}
}
