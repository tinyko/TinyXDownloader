package backend

import (
	"fmt"
	"net/url"
	"strings"
)

func buildTwitterURL(username, timelineType string) string {
	// Special case: bookmarks don't need username
	if timelineType == "bookmarks" {
		return "https://x.com/i/bookmarks"
	}

	// Clean username - extract handle from URL if needed
	username = cleanUsername(username)

	// Build URL based on timeline type
	baseURL := "https://x.com/" + username
	switch timelineType {
	case "media":
		return baseURL + "/media"
	case "timeline":
		return baseURL + "/timeline" // Best for cursor support
	case "tweets":
		return baseURL + "/tweets"
	case "with_replies":
		return baseURL + "/with_replies"
	case "likes":
		return baseURL + "/likes"
	default:
		return baseURL + "/timeline" // Default to timeline for reliable cursor
	}
}

// cleanUsername extracts the handle from different input formats
// Handles: @username, username, https://x.com/username, https://x.com/username/media, etc.
func cleanUsername(username string) string {
	username = strings.TrimSpace(username)
	username = strings.TrimPrefix(username, "@")

	if strings.Contains(username, "x.com/") || strings.Contains(username, "twitter.com/") {
		parsed := username
		if !strings.HasPrefix(parsed, "http://") && !strings.HasPrefix(parsed, "https://") {
			parsed = "https://" + strings.TrimPrefix(parsed, "//")
		}
		if u, err := url.Parse(parsed); err == nil {
			segments := strings.Split(strings.Trim(u.Path, "/"), "/")
			// Skip special paths like /i/bookmarks, /search, /home, /explore
			if len(segments) > 0 && segments[0] != "" {
				firstSegment := strings.ToLower(segments[0])
				// These are not usernames
				if firstSegment == "i" || firstSegment == "search" || firstSegment == "home" || firstSegment == "explore" || firstSegment == "settings" || firstSegment == "messages" || firstSegment == "notifications" {
					return username // Return as-is, let caller handle
				}
				return segments[0]
			}
		}
	}

	return username
}

// ensureURLScheme normalises URLs so the CLI accepts them
func ensureURLScheme(raw string) string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return raw
	}
	if strings.HasPrefix(raw, "http://") || strings.HasPrefix(raw, "https://") {
		return raw
	}
	if strings.HasPrefix(raw, "//") {
		return "https:" + raw
	}
	return "https://" + strings.TrimPrefix(raw, "//")
}

// buildSearchURL assembles an X.com search URL for date range queries
func buildSearchURL(username, startDate, endDate, mediaFilter string, includeRetweets bool) string {
	trimmed := strings.TrimSpace(username)
	lower := strings.ToLower(trimmed)
	if strings.Contains(lower, "search?q=") {
		return ensureURLScheme(trimmed)
	}

	handle := cleanUsername(trimmed)
	var parts []string
	if handle != "" {
		parts = append(parts, fmt.Sprintf("from:%s", handle))
	}
	if startDate != "" {
		parts = append(parts, fmt.Sprintf("since:%s", startDate))
	}
	if endDate != "" {
		parts = append(parts, fmt.Sprintf("until:%s", endDate))
	}

	switch strings.ToLower(strings.TrimSpace(mediaFilter)) {
	case "image", "images", "photo", "photos":
		parts = append(parts, "filter:images")
	case "video", "videos", "gif", "gifs":
		parts = append(parts, "filter:videos")
	case "text":
		parts = append(parts, "-filter:media")
	default:
		parts = append(parts, "filter:media")
	}

	if !includeRetweets {
		parts = append(parts, "-filter:retweets")
	}

	query := url.QueryEscape(strings.Join(parts, " "))
	return fmt.Sprintf("https://x.com/search?q=%s&src=typed_query&f=live", query)
}
