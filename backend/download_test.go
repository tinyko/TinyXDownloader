package backend

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"slices"
	"testing"
	"time"
)

func TestDownloadFileWithContextRenamesTempFileOnSuccess(t *testing.T) {
	const body = "download-complete"

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Length", "17")
		_, _ = w.Write([]byte(body))
	}))
	defer server.Close()

	outputPath := filepath.Join(t.TempDir(), "image.jpg")
	err := downloadFileWithContext(context.Background(), server.Client(), server.URL, outputPath)
	if err != nil {
		t.Fatalf("download failed: %v", err)
	}

	data, err := os.ReadFile(outputPath)
	if err != nil {
		t.Fatalf("failed to read output file: %v", err)
	}
	if string(data) != body {
		t.Fatalf("unexpected file contents: got %q want %q", string(data), body)
	}

	if _, err := os.Stat(getPartialDownloadPath(outputPath)); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("expected temp file to be removed, got err=%v", err)
	}
}

func TestDownloadFileWithContextCleansPartialFileOnCancel(t *testing.T) {
	firstChunkWritten := make(chan struct{})
	releaseServer := make(chan struct{})

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		flusher, _ := w.(http.Flusher)
		w.Header().Set("Content-Length", "131072")

		_, _ = w.Write(make([]byte, 65536))
		if flusher != nil {
			flusher.Flush()
		}
		close(firstChunkWritten)

		select {
		case <-releaseServer:
		case <-r.Context().Done():
			return
		}

		time.Sleep(50 * time.Millisecond)
		_, _ = w.Write(make([]byte, 65536))
	}))
	defer server.Close()

	outputPath := filepath.Join(t.TempDir(), "video.mp4")
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	errCh := make(chan error, 1)
	go func() {
		errCh <- downloadFileWithContext(ctx, server.Client(), server.URL, outputPath)
	}()

	<-firstChunkWritten
	cancel()
	close(releaseServer)

	err := <-errCh
	if err == nil {
		t.Fatal("expected cancellation error, got nil")
	}

	if _, statErr := os.Stat(outputPath); !errors.Is(statErr, os.ErrNotExist) {
		t.Fatalf("expected final file to be absent after cancel, got err=%v", statErr)
	}
	if _, statErr := os.Stat(getPartialDownloadPath(outputPath)); !errors.Is(statErr, os.ErrNotExist) {
		t.Fatalf("expected temp file to be cleaned after cancel, got err=%v", statErr)
	}
}

func TestShouldSkipExistingFileRemovesZeroLengthFile(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Fatalf("expected no remote requests, got %s", r.Method)
	}))
	defer server.Close()

	outputPath := filepath.Join(t.TempDir(), "image.jpg")
	if err := os.WriteFile(outputPath, nil, 0644); err != nil {
		t.Fatalf("failed to create existing file: %v", err)
	}
	if err := os.WriteFile(getPartialDownloadPath(outputPath), []byte("stale"), 0644); err != nil {
		t.Fatalf("failed to create temp file: %v", err)
	}

	shouldSkip, err := shouldSkipExistingFile(context.Background(), server.Client(), server.URL, outputPath, "photo")
	if err != nil {
		t.Fatalf("shouldSkipExistingFile returned error: %v", err)
	}
	if shouldSkip {
		t.Fatal("expected zero-length file to be redownloaded")
	}

	if _, statErr := os.Stat(outputPath); !errors.Is(statErr, os.ErrNotExist) {
		t.Fatalf("expected invalid final file to be removed, got err=%v", statErr)
	}
	if _, statErr := os.Stat(getPartialDownloadPath(outputPath)); !errors.Is(statErr, os.ErrNotExist) {
		t.Fatalf("expected stale temp file to be removed, got err=%v", statErr)
	}
}

func TestShouldSkipExistingFileKeepsExistingFileWithoutRemoteCheck(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Fatalf("expected no remote requests, got %s", r.Method)
	}))
	defer server.Close()

	outputPath := filepath.Join(t.TempDir(), "image.jpg")
	if err := os.WriteFile(outputPath, make([]byte, 40), 0644); err != nil {
		t.Fatalf("failed to create existing file: %v", err)
	}
	if err := os.WriteFile(getPartialDownloadPath(outputPath), []byte("stale"), 0644); err != nil {
		t.Fatalf("failed to create temp file: %v", err)
	}

	shouldSkip, err := shouldSkipExistingFile(context.Background(), server.Client(), server.URL, outputPath, "photo")
	if err != nil {
		t.Fatalf("shouldSkipExistingFile returned error: %v", err)
	}
	if !shouldSkip {
		t.Fatal("expected complete file to be skipped")
	}

	if _, err := os.Stat(outputPath); err != nil {
		t.Fatalf("expected final file to remain, got err=%v", err)
	}
	if _, statErr := os.Stat(getPartialDownloadPath(outputPath)); !errors.Is(statErr, os.ErrNotExist) {
		t.Fatalf("expected stale temp file to be removed, got err=%v", statErr)
	}
}

func TestShouldRetryDownloadTreatsConnectionResetAsTransient(t *testing.T) {
	if !shouldRetryDownload(errors.New("read tcp 127.0.0.1: connection reset by peer")) {
		t.Fatal("expected connection reset download errors to be retryable")
	}
}

func TestSelectDownloadWorkerCountUsesVideoCapForVideoOnlyBatches(t *testing.T) {
	tasks := []downloadTask{
		{item: MediaItem{Type: "video"}},
		{item: MediaItem{Type: "animated_gif"}},
		{item: MediaItem{Type: "video"}},
		{item: MediaItem{Type: "gif"}},
		{item: MediaItem{Type: "video"}},
	}

	got := selectDownloadWorkerCount(tasks)
	if got != MaxConcurrentVideoDownloads {
		t.Fatalf("unexpected worker count: got %d want %d", got, MaxConcurrentVideoDownloads)
	}
}

func TestSelectDownloadWorkerCountKeepsDefaultForMixedBatch(t *testing.T) {
	tasks := []downloadTask{
		{item: MediaItem{Type: "video"}},
		{item: MediaItem{Type: "photo"}},
		{item: MediaItem{Type: "video"}},
	}

	got := selectDownloadWorkerCount(tasks)
	if got != len(tasks) {
		t.Fatalf("unexpected worker count: got %d want %d", got, len(tasks))
	}
}

func TestSelectDownloadWorkerCountUsesImageCapForPhotoOnlyBatches(t *testing.T) {
	tasks := make([]downloadTask, 24)
	for i := range tasks {
		tasks[i] = downloadTask{item: MediaItem{Type: "photo"}}
	}

	got := selectDownloadWorkerCount(tasks)
	if got != MaxConcurrentImageDownloads {
		t.Fatalf("unexpected worker count: got %d want %d", got, MaxConcurrentImageDownloads)
	}
}

func TestCreateDownloadHTTPClientUsesExtendedTimeout(t *testing.T) {
	client, err := createDownloadHTTPClient("")
	if err != nil {
		t.Fatalf("createDownloadHTTPClient returned error: %v", err)
	}

	if client.Timeout != downloadRequestTimeout {
		t.Fatalf("unexpected download timeout: got %v want %v", client.Timeout, downloadRequestTimeout)
	}
}

func TestDownloadScopePayloadsProgressAndStatusUsesUnifiedBatch(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Length", "4")
		_, _ = w.Write([]byte("data"))
	}))
	defer server.Close()

	outputDir := t.TempDir()
	payloads := []*ScopeMediaDownloadPayload{
		{
			Username: "alice",
			Items: []MediaItem{
				{
					URL:     server.URL + "/alice-1.jpg",
					Date:    "2026-04-14T12:00:00",
					TweetID: 1001,
					Type:    "photo",
					Content: "alice one",
				},
			},
		},
		{
			Username:         "bob",
			RootSubdirectory: "My Bookmarks",
			Items: []MediaItem{
				{
					URL:     server.URL + "/bob-1.jpg",
					Date:    "2026-04-14T12:00:01",
					TweetID: 2001,
					Type:    "photo",
					Content: "bob one",
				},
				{
					URL:     server.URL + "/bob-2.jpg",
					Date:    "2026-04-14T12:00:02",
					TweetID: 2002,
					Type:    "photo",
					Content: "bob two",
				},
			},
		},
	}

	var progressEvents [][2]int
	progress := func(current, total int) {
		progressEvents = append(progressEvents, [2]int{current, total})
	}

	downloaded, skipped, failed, err := DownloadScopePayloadsProgressAndStatus(
		payloads,
		outputDir,
		progress,
		nil,
		context.Background(),
		"",
	)
	if err != nil {
		t.Fatalf("download scope payloads: %v", err)
	}
	if downloaded != 3 || skipped != 0 || failed != 0 {
		t.Fatalf("unexpected download counts: downloaded=%d skipped=%d failed=%d", downloaded, skipped, failed)
	}
	if len(progressEvents) == 0 {
		t.Fatal("expected progress events")
	}
	lastProgress := progressEvents[len(progressEvents)-1]
	if lastProgress[0] != 3 || lastProgress[1] != 3 {
		t.Fatalf("expected final unified progress 3/3, got %d/%d", lastProgress[0], lastProgress[1])
	}

	aliceFiles, err := os.ReadDir(filepath.Join(outputDir, "alice", "images"))
	if err != nil {
		t.Fatalf("read alice image dir: %v", err)
	}
	if len(aliceFiles) != 1 {
		t.Fatalf("expected 1 alice file, got %d", len(aliceFiles))
	}

	bobFiles, err := os.ReadDir(filepath.Join(outputDir, "My Bookmarks", "bob", "images"))
	if err != nil {
		t.Fatalf("read bob image dir: %v", err)
	}
	if len(bobFiles) != 2 {
		t.Fatalf("expected 2 bob files, got %d", len(bobFiles))
	}

	names := []string{bobFiles[0].Name(), bobFiles[1].Name()}
	slices.Sort(names)
	for _, name := range names {
		if filepath.Ext(name) != ".jpg" {
			t.Fatalf("expected jpg output, got %q", name)
		}
		if _, err := os.Stat(filepath.Join(outputDir, "My Bookmarks", "bob", "images", name+partialDownloadSuffix)); !errors.Is(err, os.ErrNotExist) {
			t.Fatalf("expected no partial file for %q, got err=%v", name, err)
		}
	}
}
