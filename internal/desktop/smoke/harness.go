package smoke

import (
	"context"
	"fmt"
	"sync"
	"time"
	"twitterxmediabatchdownloader/backend"
)

type Harness struct {
	mu             sync.Mutex
	activeRequests map[string]context.CancelFunc
}

type DownloadResult struct {
	Downloaded int
	Skipped    int
	Failed     int
	Message    string
}

type IntegrityProgress struct {
	Phase         string
	ScannedFiles  int
	CheckedFiles  int
	VerifiedFiles int
}

func NewHarness() *Harness {
	return &Harness{
		activeRequests: make(map[string]context.CancelFunc),
	}
}

func (h *Harness) CancelRequest(requestID string) bool {
	h.mu.Lock()
	cancel := h.activeRequests[requestID]
	h.mu.Unlock()
	if cancel == nil {
		return false
	}
	cancel()
	return true
}

func (h *Harness) ExtractTimeline(req backend.TimelineRequest) (*backend.TwitterResponse, error) {
	smokeCtx, cancel := h.registerRequest(req.RequestID)
	defer cancel()
	defer h.releaseRequest(req.RequestID)

	select {
	case <-time.After(700 * time.Millisecond):
	case <-smokeCtx.Done():
		return nil, fmt.Errorf("extractor canceled")
	}

	username := req.Username
	if username == "" {
		username = "bookmarks"
	}

	page := req.Page
	if req.Cursor != "" {
		page = 1
	}

	completed := page >= 1
	cursor := ""
	if !completed {
		cursor = "smoke-next-page"
	}

	entries := buildTimelineEntries(username, page, req.MediaType)
	return &backend.TwitterResponse{
		AccountInfo: backend.AccountInfo{
			Name:           username,
			Nick:           "Smoke " + username,
			Date:           "2026-04-15",
			FollowersCount: 4242,
			FriendsCount:   128,
			ProfileImage:   "https://example.com/avatar.png",
			StatusesCount:  256,
		},
		TotalURLs: len(entries),
		Timeline:  entries,
		Metadata: backend.ExtractMetadata{
			NewEntries: len(entries),
			Page:       page,
			BatchSize:  3,
			HasMore:    !completed,
			Cursor:     cursor,
			Completed:  completed,
		},
		Cursor:    cursor,
		Completed: completed,
	}, nil
}

func (h *Harness) ExtractDateRange(req backend.DateRangeRequest) (*backend.TwitterResponse, error) {
	return h.ExtractTimeline(backend.TimelineRequest{
		Username:     req.Username,
		AuthToken:    req.AuthToken,
		TimelineType: "timeline",
		BatchSize:    3,
		Page:         1,
		MediaType:    req.MediaFilter,
		Retweets:     req.Retweets,
		RequestID:    req.RequestID,
	})
}

func RunDownloadSession(ctx context.Context, totalItems int, progress func(current, total, percent int)) DownloadResult {
	if totalItems <= 0 {
		totalItems = 6
	}

	ticker := time.NewTicker(250 * time.Millisecond)
	defer ticker.Stop()

	current := 0
	for current < totalItems {
		select {
		case <-ctx.Done():
			return DownloadResult{
				Downloaded: current,
				Skipped:    totalItems - current,
				Failed:     0,
				Message:    "Download cancelled",
			}
		case <-ticker.C:
			current += 1
			progress(current, totalItems, (current*100)/totalItems)
		}
	}

	return DownloadResult{
		Downloaded: totalItems,
		Skipped:    0,
		Failed:     0,
		Message:    fmt.Sprintf("Downloaded %d files, 0 skipped, 0 failed", totalItems),
	}
}

func CheckDownloadIntegrity(downloadPath, mode string) backend.DownloadIntegrityReport {
	return backend.DownloadIntegrityReport{
		Mode:              backend.NormalizeDownloadIntegrityModeForApp(mode),
		DownloadPath:      downloadPath,
		ScannedFiles:      24,
		CheckedFiles:      18,
		CompleteFiles:     18,
		PartialFiles:      0,
		IncompleteFiles:   0,
		UntrackedFiles:    0,
		UnverifiableFiles: 0,
		Issues:            []backend.DownloadIntegrityIssue{},
	}
}

func RunIntegrityTask(
	ctx context.Context,
	downloadPath string,
	mode string,
	onProgress func(IntegrityProgress),
) (backend.DownloadIntegrityReport, error) {
	normalizedMode := backend.NormalizeDownloadIntegrityModeForApp(mode)
	progressPhases := []IntegrityProgress{
		{Phase: "preparing-index", ScannedFiles: 3, CheckedFiles: 0, VerifiedFiles: 0},
		{Phase: "checking-files", ScannedFiles: 12, CheckedFiles: 8, VerifiedFiles: verifiedCount(8)},
		{Phase: "finalizing-report", ScannedFiles: 24, CheckedFiles: 18, VerifiedFiles: verifiedCount(18)},
	}

	for _, step := range progressPhases {
		select {
		case <-ctx.Done():
			return backend.DownloadIntegrityReport{}, ctx.Err()
		case <-time.After(450 * time.Millisecond):
			onProgress(step)
		}
	}

	if normalizedMode == "deep" {
		for i := 0; i < 6; i++ {
			select {
			case <-ctx.Done():
				return backend.DownloadIntegrityReport{}, ctx.Err()
			case <-time.After(400 * time.Millisecond):
				onProgress(IntegrityProgress{
					Phase:         "verifying-remote",
					ScannedFiles:  24,
					CheckedFiles:  24,
					VerifiedFiles: 22,
				})
			}
		}
	}

	return backend.DownloadIntegrityReport{
		Mode:              normalizedMode,
		DownloadPath:      downloadPath,
		ScannedFiles:      24,
		CheckedFiles:      24,
		CompleteFiles:     24,
		PartialFiles:      0,
		IncompleteFiles:   0,
		UntrackedFiles:    0,
		UnverifiableFiles: 0,
		Issues:            []backend.DownloadIntegrityIssue{},
	}, nil
}

func (h *Harness) registerRequest(requestID string) (context.Context, context.CancelFunc) {
	ctx, cancel := context.WithCancel(context.Background())
	if requestID == "" {
		return ctx, cancel
	}

	h.mu.Lock()
	h.activeRequests[requestID] = cancel
	h.mu.Unlock()

	return ctx, cancel
}

func (h *Harness) releaseRequest(requestID string) {
	if requestID == "" {
		return
	}

	h.mu.Lock()
	delete(h.activeRequests, requestID)
	h.mu.Unlock()
}

func buildTimelineEntries(username string, page int, mediaType string) []backend.TimelineEntry {
	baseID := int64(10_000 + page*100)
	normalizedType := mediaType

	switch normalizedType {
	case "", "all":
		normalizedType = "photo"
	case "image":
		normalizedType = "photo"
	case "gif":
		normalizedType = "animated_gif"
	}

	return []backend.TimelineEntry{
		{
			URL:            fmt.Sprintf("https://example.com/%s/%d-a.jpg", username, baseID),
			Date:           "2026-04-15T10:00:00Z",
			TweetID:        backend.TweetIDString(baseID),
			Type:           normalizedType,
			Extension:      "jpg",
			Width:          1200,
			Height:         900,
			Content:        "Smoke test entry A",
			AuthorUsername: username,
		},
		{
			URL:            fmt.Sprintf("https://example.com/%s/%d-b.jpg", username, baseID+1),
			Date:           "2026-04-15T10:05:00Z",
			TweetID:        backend.TweetIDString(baseID + 1),
			Type:           normalizedType,
			Extension:      "jpg",
			Width:          1200,
			Height:         900,
			Content:        "Smoke test entry B",
			AuthorUsername: username,
		},
		{
			URL:            fmt.Sprintf("https://example.com/%s/%d-c.jpg", username, baseID+2),
			Date:           "2026-04-15T10:10:00Z",
			TweetID:        backend.TweetIDString(baseID + 2),
			Type:           normalizedType,
			Extension:      "jpg",
			Width:          1200,
			Height:         900,
			Content:        "Smoke test entry C",
			AuthorUsername: username,
		},
	}
}

func verifiedCount(checked int) int {
	if checked <= 1 {
		return 0
	}
	return checked - 1
}
