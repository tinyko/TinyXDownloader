package backend

import (
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sync/atomic"
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
	}, server.Client(), downloadIntegrityModeDeep)
	if err != nil {
		t.Fatalf("integrity check failed: %v", err)
	}

	if report.Mode != downloadIntegrityModeDeep {
		t.Fatalf("expected deep mode report, got %q", report.Mode)
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

func TestCheckDownloadDirectoryIntegrityQuickModeSkipsRemoteValidationAndFlagsMissingFiles(t *testing.T) {
	var headRequests atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodHead {
			headRequests.Add(1)
			w.Header().Set("Content-Length", "100")
			return
		}
		_, _ = w.Write(make([]byte, 100))
	}))
	defer server.Close()

	root := t.TempDir()
	existingPath := filepath.Join(root, "alpha", "images", "complete.jpg")
	missingPath := filepath.Join(root, "alpha", "images", "missing.jpg")

	if err := os.MkdirAll(filepath.Dir(existingPath), 0755); err != nil {
		t.Fatalf("failed to create directory: %v", err)
	}
	if err := os.WriteFile(existingPath, make([]byte, 40), 0644); err != nil {
		t.Fatalf("failed to write tracked file: %v", err)
	}

	report, err := checkDownloadDirectoryIntegrity(context.Background(), root, map[string]MediaItem{
		filepath.Clean(existingPath): {
			URL:  server.URL + "/complete",
			Type: "photo",
		},
		filepath.Clean(missingPath): {
			URL:  server.URL + "/missing",
			Type: "photo",
		},
	}, server.Client(), downloadIntegrityModeQuick)
	if err != nil {
		t.Fatalf("quick integrity check failed: %v", err)
	}

	if report.Mode != downloadIntegrityModeQuick {
		t.Fatalf("expected quick mode report, got %q", report.Mode)
	}
	if headRequests.Load() != 0 {
		t.Fatalf("expected quick mode to skip remote HEAD requests, got %d", headRequests.Load())
	}
	if report.CompleteFiles != 1 {
		t.Fatalf("expected tracked existing file to count as complete in quick mode, got %d", report.CompleteFiles)
	}
	if report.IncompleteFiles != 1 {
		t.Fatalf("expected one missing tracked file, got %d", report.IncompleteFiles)
	}
	if len(report.Issues) != 1 || report.Issues[0].Reason != "missing_file" {
		t.Fatalf("expected missing_file issue, got %+v", report.Issues)
	}
}

func TestNormalizeDownloadIntegrityModeDefaultsToQuick(t *testing.T) {
	testCases := map[string]string{
		"":       downloadIntegrityModeQuick,
		"quick":  downloadIntegrityModeQuick,
		"deep":   downloadIntegrityModeDeep,
		"weird":  downloadIntegrityModeQuick,
		" DEEP ": downloadIntegrityModeDeep,
	}

	for input, expected := range testCases {
		if actual := normalizeDownloadIntegrityMode(input); actual != expected {
			t.Fatalf("mode %q normalized to %q, expected %q", input, actual, expected)
		}
	}
}

func TestDeepIntegrityCheckStillPerformsRemoteValidation(t *testing.T) {
	var headRequests atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodHead {
			headRequests.Add(1)
			w.Header().Set("Content-Length", "100")
			return
		}
		_, _ = w.Write(make([]byte, 100))
	}))
	defer server.Close()

	root := t.TempDir()
	trackedPath := filepath.Join(root, "alpha", "images", "truncated.jpg")

	if err := os.MkdirAll(filepath.Dir(trackedPath), 0755); err != nil {
		t.Fatalf("failed to create directory: %v", err)
	}
	if err := os.WriteFile(trackedPath, make([]byte, 10), 0644); err != nil {
		t.Fatalf("failed to write tracked file: %v", err)
	}

	report, err := checkDownloadDirectoryIntegrity(context.Background(), root, map[string]MediaItem{
		filepath.Clean(trackedPath): {
			URL:  server.URL + "/truncated",
			Type: "photo",
		},
	}, server.Client(), downloadIntegrityModeDeep)
	if err != nil {
		t.Fatalf("deep integrity check failed: %v", err)
	}

	if report.Mode != downloadIntegrityModeDeep {
		t.Fatalf("expected deep mode report, got %q", report.Mode)
	}
	if headRequests.Load() == 0 {
		t.Fatal("expected deep mode to perform remote validation")
	}
	if len(report.Issues) != 1 || report.Issues[0].Reason != "size_mismatch" {
		t.Fatalf("expected size_mismatch issue, got %+v", report.Issues)
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
