package backend

import (
	"encoding/json"
	"strconv"
	"strings"
)

type resolvedTimelineProjection struct {
	URL              string
	Date             string
	TweetID          string
	Type             string
	Content          string
	AuthorUsername   string
	OriginalFilename string
}

func projectionNeedsEntryJSONFallback(row timelineMediaProjection) bool {
	return strings.TrimSpace(row.URL) == "" ||
		strings.TrimSpace(row.Date) == "" ||
		strings.TrimSpace(row.TweetID) == "" ||
		strings.TrimSpace(row.Type) == "" ||
		!row.Content.Valid ||
		!row.AuthorUsername.Valid ||
		!row.OriginalFilename.Valid
}

func resolveTimelineProjection(row timelineMediaProjection) (resolvedTimelineProjection, bool) {
	resolved := resolvedTimelineProjection{
		URL:     row.URL,
		Date:    row.Date,
		TweetID: row.TweetID,
		Type:    row.Type,
	}
	if row.Content.Valid {
		resolved.Content = row.Content.String
	}
	if row.AuthorUsername.Valid {
		resolved.AuthorUsername = row.AuthorUsername.String
	}
	if row.OriginalFilename.Valid {
		resolved.OriginalFilename = row.OriginalFilename.String
	}

	if projectionNeedsEntryJSONFallback(row) && strings.TrimSpace(row.EntryJSON) != "" {
		var entry TimelineEntry
		if err := json.Unmarshal([]byte(row.EntryJSON), &entry); err == nil {
			if strings.TrimSpace(resolved.URL) == "" {
				resolved.URL = entry.URL
			}
			if strings.TrimSpace(resolved.Date) == "" {
				resolved.Date = entry.Date
			}
			if strings.TrimSpace(resolved.TweetID) == "" && entry.TweetID != 0 {
				resolved.TweetID = strconv.FormatInt(int64(entry.TweetID), 10)
			}
			if strings.TrimSpace(resolved.Type) == "" {
				resolved.Type = entry.Type
			}
			if !row.Content.Valid {
				resolved.Content = entry.Content
			}
			if !row.AuthorUsername.Valid {
				resolved.AuthorUsername = entry.AuthorUsername
			}
			if !row.OriginalFilename.Valid {
				resolved.OriginalFilename = entry.OriginalFilename
			}
		}
	}

	if strings.TrimSpace(resolved.URL) == "" {
		return resolvedTimelineProjection{}, false
	}

	return resolved, true
}

func buildSavedTimelineItemFromProjection(row timelineMediaProjection) (SavedTimelineItem, bool) {
	resolved, ok := resolveTimelineProjection(row)
	if !ok {
		return SavedTimelineItem{}, false
	}

	return SavedTimelineItem{
		URL:              resolved.URL,
		Date:             resolved.Date,
		TweetID:          resolved.TweetID,
		Type:             resolved.Type,
		Content:          resolved.Content,
		AuthorUsername:   resolved.AuthorUsername,
		OriginalFilename: resolved.OriginalFilename,
	}, true
}

func buildMediaItemFromProjection(row timelineMediaProjection, fallbackUsername string) (MediaItem, bool) {
	resolved, ok := resolveTimelineProjection(row)
	if !ok {
		return MediaItem{}, false
	}

	tweetID, _ := strconv.ParseInt(strings.TrimSpace(resolved.TweetID), 10, 64)
	itemUsername := strings.TrimSpace(resolved.AuthorUsername)
	if itemUsername == "" {
		itemUsername = strings.TrimSpace(fallbackUsername)
	}

	return MediaItem{
		URL:              resolved.URL,
		Date:             resolved.Date,
		TweetID:          tweetID,
		Type:             resolved.Type,
		Username:         itemUsername,
		Content:          resolved.Content,
		OriginalFilename: resolved.OriginalFilename,
	}, true
}
