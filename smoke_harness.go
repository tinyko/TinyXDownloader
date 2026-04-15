package main

import (
	"context"
	"encoding/json"
	"fmt"
	"sync"
	"time"
	"twitterxmediabatchdownloader/backend"
)

type smokeHarness struct {
	mu             sync.Mutex
	activeRequests map[string]context.CancelFunc
}

func newSmokeHarness() *smokeHarness {
	return &smokeHarness{
		activeRequests: make(map[string]context.CancelFunc),
	}
}

func (h *smokeHarness) registerRequest(requestID string) (context.Context, context.CancelFunc) {
	ctx, cancel := context.WithCancel(context.Background())
	if requestID == "" {
		return ctx, cancel
	}

	h.mu.Lock()
	h.activeRequests[requestID] = cancel
	h.mu.Unlock()

	return ctx, cancel
}

func (h *smokeHarness) releaseRequest(requestID string) {
	if requestID == "" {
		return
	}

	h.mu.Lock()
	delete(h.activeRequests, requestID)
	h.mu.Unlock()
}

func (h *smokeHarness) cancelRequest(requestID string) bool {
	h.mu.Lock()
	cancel := h.activeRequests[requestID]
	h.mu.Unlock()
	if cancel == nil {
		return false
	}
	cancel()
	return true
}

func (h *smokeHarness) extractTimelineStructured(req TimelineRequest) (*backend.TwitterResponse, error) {
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

	entries := buildSmokeTimelineEntries(username, page, req.MediaType)
	response := &backend.TwitterResponse{
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
	}

	return response, nil
}

func (h *smokeHarness) extractTimeline(req TimelineRequest) (string, error) {
	response, err := h.extractTimelineStructured(req)
	if err != nil {
		return "", err
	}

	payload, err := json.MarshalIndent(response, "", "  ")
	if err != nil {
		return "", err
	}
	return string(payload), nil
}

func (h *smokeHarness) extractDateRangeStructured(req DateRangeRequest) (*backend.TwitterResponse, error) {
	return h.extractTimelineStructured(TimelineRequest{
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

func (h *smokeHarness) extractDateRange(req DateRangeRequest) (string, error) {
	response, err := h.extractDateRangeStructured(req)
	if err != nil {
		return "", err
	}

	payload, err := json.MarshalIndent(response, "", "  ")
	if err != nil {
		return "", err
	}
	return string(payload), nil
}

func buildSmokeTimelineEntries(username string, page int, mediaType string) []backend.TimelineEntry {
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
