package backend

import (
	"fmt"
	"strings"
	"time"
)

const accountTimelineItemsTableSchema = `
	CREATE TABLE IF NOT EXISTS account_timeline_items (
		fetch_key TEXT NOT NULL,
		entry_key TEXT NOT NULL,
		url TEXT NOT NULL,
		tweet_id TEXT NOT NULL,
		type TEXT NOT NULL,
		date_value TEXT NOT NULL,
		date_unix_ms INTEGER DEFAULT 0,
		tweet_id_num INTEGER,
		content TEXT,
		author_username TEXT,
		original_filename TEXT,
		entry_json TEXT NOT NULL,
		PRIMARY KEY (fetch_key, entry_key)
	)
`

type FetchScopeRecord struct {
	Username     string `json:"username"`
	MediaType    string `json:"media_type"`
	TimelineType string `json:"timeline_type"`
	Retweets     bool   `json:"retweets"`
	QueryKey     string `json:"query_key"`
}

type accountSummaryRecord struct {
	ID              int64
	Username        string
	Name            string
	ProfileImage    string
	AccountInfoJSON string
	TotalMedia      int
	LastFetched     time.Time
	ResponseJSON    string
	MediaType       string
	TimelineType    string
	Retweets        bool
	QueryKey        string
	Cursor          string
	Completed       bool
	FollowersCount  int
	StatusesCount   int
	FetchKey        string
	StorageVersion  int
}

type ScopeMediaDownloadPayload struct {
	Scope            FetchScopeRecord
	Username         string
	RootSubdirectory string
	Items            []MediaItem
}

type AccountSnapshotSummary struct {
	AccountInfo AccountInfo `json:"account_info"`
	TotalURLs   int         `json:"total_urls"`
	Cursor      string      `json:"cursor,omitempty"`
	Completed   bool        `json:"completed"`
}

func normalizeFetchScopeRecord(scope FetchScopeRecord) FetchScopeRecord {
	normalized := FetchScopeRecord{
		Username:     strings.TrimSpace(scope.Username),
		MediaType:    strings.TrimSpace(scope.MediaType),
		TimelineType: strings.TrimSpace(scope.TimelineType),
		Retweets:     scope.Retweets,
		QueryKey:     strings.TrimSpace(scope.QueryKey),
	}
	if normalized.MediaType == "" {
		normalized.MediaType = "all"
	}
	if normalized.TimelineType == "" {
		normalized.TimelineType = "timeline"
	}
	return normalized
}

func buildFetchKeyFromScope(scope FetchScopeRecord) string {
	normalized := normalizeFetchScopeRecord(scope)
	return buildFetchKey(
		normalized.Username,
		normalized.MediaType,
		normalized.TimelineType,
		normalized.Retweets,
		normalized.QueryKey,
	)
}

func buildTimelineEntryStorageKey(entry TimelineEntry) string {
	return fmt.Sprintf("%d|%s", int64(entry.TweetID), strings.TrimSpace(entry.URL))
}

func parseTimelineEntryDateUnixMs(value string) int64 {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return 0
	}

	layouts := []string{
		time.RFC3339Nano,
		time.RFC3339,
		"2006-01-02T15:04:05",
		"2006-01-02t15:04:05",
		"2006-01-02 15:04:05",
		"2006-01-02",
	}

	for _, layout := range layouts {
		parsed, err := time.Parse(layout, trimmed)
		if err == nil {
			return parsed.UnixMilli()
		}
	}

	return 0
}
