package backend

import (
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

func TestCheckDownloadDirectoryIntegrityDetectsPartialAndTruncatedFiles(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/complete":
			if r.Method == http.MethodHead {
				w.Header().Set("Content-Length", "100")
				return
			}
			_, _ = w.Write(make([]byte, 100))
		case "/truncated":
			if r.Method == http.MethodHead {
				w.Header().Set("Content-Length", "100")
				return
			}
			_, _ = w.Write(make([]byte, 100))
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer server.Close()

	root := t.TempDir()
	completePath := filepath.Join(root, "alpha", "images", "complete.jpg")
	truncatedPath := filepath.Join(root, "alpha", "images", "truncated.jpg")
	partialPath := filepath.Join(root, "alpha", "images", "stuck.jpg.part")
	untrackedPath := filepath.Join(root, "alpha", "images", "unknown.jpg")

	for _, path := range []string{completePath, truncatedPath, partialPath, untrackedPath} {
		if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
			t.Fatalf("failed to create directory for %s: %v", path, err)
		}
	}

	if err := os.WriteFile(completePath, make([]byte, 100), 0644); err != nil {
		t.Fatalf("failed to write complete file: %v", err)
	}
	if err := os.WriteFile(truncatedPath, make([]byte, 40), 0644); err != nil {
		t.Fatalf("failed to write truncated file: %v", err)
	}
	if err := os.WriteFile(partialPath, []byte("stale"), 0644); err != nil {
		t.Fatalf("failed to write partial file: %v", err)
	}
	if err := os.WriteFile(untrackedPath, make([]byte, 20), 0644); err != nil {
		t.Fatalf("failed to write untracked file: %v", err)
	}

	report, err := checkDownloadDirectoryIntegrity(context.Background(), root, map[string]MediaItem{
		filepath.Clean(completePath): {
			URL:  server.URL + "/complete",
			Type: "photo",
		},
		filepath.Clean(truncatedPath): {
			URL:  server.URL + "/truncated",
			Type: "photo",
		},
	}, server.Client())
	if err != nil {
		t.Fatalf("integrity check failed: %v", err)
	}

	if report.ScannedFiles != 4 {
		t.Fatalf("expected 4 scanned files, got %d", report.ScannedFiles)
	}
	if report.CheckedFiles != 3 {
		t.Fatalf("expected 3 checked files, got %d", report.CheckedFiles)
	}
	if report.CompleteFiles != 1 {
		t.Fatalf("expected 1 complete file, got %d", report.CompleteFiles)
	}
	if report.IncompleteFiles != 1 {
		t.Fatalf("expected 1 incomplete file, got %d", report.IncompleteFiles)
	}
	if report.PartialFiles != 1 {
		t.Fatalf("expected 1 partial file, got %d", report.PartialFiles)
	}
	if report.UntrackedFiles != 1 {
		t.Fatalf("expected 1 untracked file, got %d", report.UntrackedFiles)
	}
	if len(report.Issues) != 2 {
		t.Fatalf("expected 2 issues, got %d", len(report.Issues))
	}

	reasons := []string{report.Issues[0].Reason, report.Issues[1].Reason}
	if !(containsString(reasons, "partial_file") && containsString(reasons, "size_mismatch")) {
		t.Fatalf("unexpected issue reasons: %#v", reasons)
	}
}

func containsString(values []string, target string) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}
