package backend

import (
	"context"
	"errors"
	"strings"
)

type GoTwitterEngine struct {
	clientFactory func() (*xAPIClient, error)
}

func (e *GoTwitterEngine) Name() string {
	return "go-twitter"
}

func (e *GoTwitterEngine) TimelineSupport(req TimelineRequest) (bool, string) {
	spec := buildTimelineExtractorSpec(req)
	timelineType := strings.ToLower(strings.TrimSpace(spec.timelineType))
	mediaType := strings.ToLower(strings.TrimSpace(req.MediaType))

	switch timelineType {
	case "bookmarks":
		switch mediaType {
		case "", "all", "image", "video", "gif", "text":
			return true, ""
		default:
			return false, "go private bookmarks extractor only supports all|image|video|gif|text"
		}
	case "likes":
		switch mediaType {
		case "", "all", "image", "video", "gif", "text":
			return true, ""
		default:
			return false, "go private likes extractor only supports all|image|video|gif|text"
		}
	case "search":
		return false, "go search extraction will ship in phase 2"
	case "media":
		switch mediaType {
		case "", "all", "image", "video", "gif":
			return true, ""
		case "text":
			return false, "go public media extractor does not support text-only timeline requests"
		default:
			return false, "go public media extractor only supports all|image|video|gif"
		}
	case "tweets", "timeline", "with_replies":
		switch mediaType {
		case "", "all", "image", "video", "gif", "text":
			return true, ""
		default:
			return false, "go public timeline extractor only supports all|image|video|gif|text"
		}
	default:
		return false, "go extractor does not support this timeline request yet"
	}
}

func (e *GoTwitterEngine) DateRangeSupport(req DateRangeRequest) (bool, string) {
	mediaFilter := strings.ToLower(strings.TrimSpace(req.MediaFilter))
	switch mediaFilter {
	case "", "all", "image", "video", "gif", "text":
	default:
		return false, "go public date-range extractor only supports all|image|video|gif|text"
	}

	username := strings.ToLower(strings.TrimSpace(req.Username))
	if username == "" {
		return false, "go public date-range extractor requires a username"
	}
	if strings.Contains(username, "/search?") || strings.Contains(username, "search?q=") {
		return false, "go public date-range extractor only supports username-based requests"
	}

	return true, ""
}

func (e *GoTwitterEngine) ExtractTimeline(ctx context.Context, req TimelineRequest) (*TwitterResponse, error) {
	if err := contextError(ctx); err != nil {
		return nil, err
	}
	if ok, reason := e.TimelineSupport(req); !ok {
		return nil, newEngineUnsupportedError(e.Name(), reason)
	}

	clientFactory := e.clientFactory
	if clientFactory == nil {
		clientFactory = defaultXAPIClient
	}
	client, err := clientFactory()
	if err != nil {
		return nil, newEngineFallbackRequiredError(e.Name(), "failed to initialize native x client", err)
	}

	spec := buildTimelineExtractorSpec(req)

	var response *TwitterResponse
	switch strings.ToLower(strings.TrimSpace(spec.timelineType)) {
	case "media":
		response, err = client.extractPublicMediaTimeline(ctx, req)
	case "timeline", "tweets", "with_replies":
		response, err = client.extractPublicTimeline(ctx, req)
	case "likes":
		response, err = client.extractPrivateLikesTimeline(ctx, req)
	case "bookmarks":
		response, err = client.extractPrivateBookmarksTimeline(ctx, req)
	default:
		return nil, newEngineUnsupportedError(e.Name(), "go extractor does not support this timeline request yet")
	}
	if err != nil {
		if errors.Is(err, ErrEngineFallbackRequired) || errors.Is(err, ErrEngineUnsupported) {
			return nil, err
		}
		return nil, newEngineFallbackRequiredError(e.Name(), "native x timeline extraction failed", err)
	}
	return response, nil
}

func (e *GoTwitterEngine) ExtractDateRange(ctx context.Context, req DateRangeRequest) (*TwitterResponse, error) {
	if err := contextError(ctx); err != nil {
		return nil, err
	}
	if ok, reason := e.DateRangeSupport(req); !ok {
		return nil, newEngineUnsupportedError(e.Name(), reason)
	}

	clientFactory := e.clientFactory
	if clientFactory == nil {
		clientFactory = defaultXAPIClient
	}
	client, err := clientFactory()
	if err != nil {
		return nil, newEngineFallbackRequiredError(e.Name(), "failed to initialize native x client", err)
	}

	response, err := client.extractPublicSearchDateRange(ctx, req)
	if err != nil {
		if errors.Is(err, ErrEngineFallbackRequired) || errors.Is(err, ErrEngineUnsupported) {
			return nil, err
		}
		return nil, newEngineFallbackRequiredError(e.Name(), "native x date-range extraction failed", err)
	}
	return response, nil
}
