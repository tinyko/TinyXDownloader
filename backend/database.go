package backend

import (
	"database/sql"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// AccountDB represents a saved account in the database
type AccountDB struct {
	ID             int64     `json:"id"`
	Username       string    `json:"username"`
	Name           string    `json:"name"`
	ProfileImage   string    `json:"profile_image"`
	TotalMedia     int       `json:"total_media"`
	LastFetched    time.Time `json:"last_fetched"`
	ResponseJSON   string    `json:"response_json"`
	MediaType      string    `json:"media_type"`
	TimelineType   string    `json:"timeline_type"`
	Retweets       bool      `json:"retweets"`
	QueryKey       string    `json:"query_key"`
	Cursor         string    `json:"cursor"`
	Completed      bool      `json:"completed"`
	FollowersCount int       `json:"followers_count"`
	StatusesCount  int       `json:"statuses_count"`
}

// AccountListItem represents a simplified account for listing
type AccountListItem struct {
	ID             int64  `json:"id"`
	Username       string `json:"username"`
	Name           string `json:"name"`
	ProfileImage   string `json:"profile_image"`
	TotalMedia     int    `json:"total_media"`
	LastFetched    string `json:"last_fetched"`
	GroupName      string `json:"group_name"`
	GroupColor     string `json:"group_color"`
	MediaType      string `json:"media_type"`
	TimelineType   string `json:"timeline_type"`
	Retweets       bool   `json:"retweets"`
	QueryKey       string `json:"query_key"`
	Cursor         string `json:"cursor"`
	Completed      bool   `json:"completed"`
	FollowersCount int    `json:"followers_count"`
	StatusesCount  int    `json:"statuses_count"`
}

type GroupInfo struct {
	Name  string `json:"name"`
	Color string `json:"color"`
}

type SavedAccountsWorkspaceData struct {
	Accounts []AccountListItem `json:"accounts"`
	Groups   []GroupInfo       `json:"groups"`
}

var db *sql.DB

// GetDBPath returns the database file path
func GetDBPath() string {
	homeDir, err := os.UserHomeDir()
	if err != nil {
		homeDir = "."
	}
	return filepath.Join(homeDir, ".twitterxmediabatchdownloader", "accounts.db")
}

func buildFetchKey(username, mediaType, timelineType string, retweets bool, queryKey string) string {
	normalizedUsername := strings.ToLower(strings.TrimSpace(username))
	normalizedMediaType := strings.TrimSpace(mediaType)
	if normalizedMediaType == "" {
		normalizedMediaType = "all"
	}
	normalizedTimelineType := strings.TrimSpace(timelineType)
	if normalizedTimelineType == "" {
		normalizedTimelineType = "timeline"
	}
	normalizedQueryKey := strings.TrimSpace(queryKey)
	retweetsFlag := "0"
	if retweets {
		retweetsFlag = "1"
	}

	return strings.Join([]string{
		normalizedUsername,
		normalizedMediaType,
		normalizedTimelineType,
		retweetsFlag,
		normalizedQueryKey,
	}, "|")
}

func sanitizeFilenamePart(value string) string {
	replacer := strings.NewReplacer(
		"/", "-",
		"\\", "-",
		":", "-",
		"?", "",
		"*", "",
		"\"", "",
		"<", "",
		">", "",
		"|", "",
		" ", "_",
	)
	sanitized := replacer.Replace(strings.TrimSpace(value))
	if sanitized == "" {
		return ""
	}
	return sanitized
}
