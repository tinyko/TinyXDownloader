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
