package backend

import (
	"encoding/json"
	"fmt"
)

type TweetIDString int64

// MarshalJSON converts TweetIDString to JSON string to preserve precision in JavaScript
func (t TweetIDString) MarshalJSON() ([]byte, error) {
	return []byte(fmt.Sprintf(`"%d"`, t)), nil
}

// UnmarshalJSON accepts both number and string from JSON
func (t *TweetIDString) UnmarshalJSON(data []byte) error {
	// Try to unmarshal as number first (from extractor)
	var num int64
	if err := json.Unmarshal(data, &num); err == nil {
		*t = TweetIDString(num)
		return nil
	}
	// Try as string (for future compatibility)
	var str string
	if err := json.Unmarshal(data, &str); err == nil {
		parsed, err := fmt.Sscanf(str, "%d", &num)
		if err != nil || parsed != 1 {
			return fmt.Errorf("invalid tweet_id string: %s", str)
		}
		*t = TweetIDString(num)
		return nil
	}
	return fmt.Errorf("tweet_id must be number or string")
}

// Author represents tweet author information from extractor
type Author struct {
	ID   int64  `json:"id"`
	Name string `json:"name"`
	Nick string `json:"nick"`
}

// UserInfo represents full user information from extractor
type UserInfo struct {
	ID              int64  `json:"id"`
	Name            string `json:"name"`
	Nick            string `json:"nick"`
	Location        string `json:"location"`
	Date            string `json:"date"`
	Verified        bool   `json:"verified"`
	Protected       bool   `json:"protected"`
	ProfileBanner   string `json:"profile_banner"`
	ProfileImage    string `json:"profile_image"`
	FavouritesCount int    `json:"favourites_count"`
	FollowersCount  int    `json:"followers_count"`
	FriendsCount    int    `json:"friends_count"`
	ListedCount     int    `json:"listed_count"`
	MediaCount      int    `json:"media_count"`
	StatusesCount   int    `json:"statuses_count"`
	Description     string `json:"description"`
	URL             string `json:"url"`
}

// CLIMediaItem represents a single media entry from extractor CLI
type CLIMediaItem struct {
	URL            string        `json:"url"`
	TweetID        TweetIDString `json:"tweet_id"`
	RetweetID      TweetIDString `json:"retweet_id"`
	QuoteID        TweetIDString `json:"quote_id"`
	ReplyID        TweetIDString `json:"reply_id"`
	ConversationID TweetIDString `json:"conversation_id"`
	Date           string        `json:"date"`
	Extension      string        `json:"extension"`
	Width          int           `json:"width"`
	Height         int           `json:"height"`
	Type           string        `json:"type"`
	Bitrate        int           `json:"bitrate"`
	Duration       float64       `json:"duration"`
	Author         UserInfo      `json:"author"`
	User           UserInfo      `json:"user"`
	Content        string        `json:"content"`
	FavoriteCount  int           `json:"favorite_count"`
	RetweetCount   int           `json:"retweet_count"`
	ReplyCount     int           `json:"reply_count"`
	QuoteCount     int           `json:"quote_count"`
	BookmarkCount  int           `json:"bookmark_count"`
	ViewCount      int           `json:"view_count"`
	Source         string        `json:"source"`
	Sensitive      bool          `json:"sensitive"`
}

// TweetMetadata represents tweet metadata from extractor
type TweetMetadata struct {
	TweetID        TweetIDString `json:"tweet_id"`
	RetweetID      TweetIDString `json:"retweet_id,omitempty"`
	QuoteID        TweetIDString `json:"quote_id,omitempty"`
	ReplyID        TweetIDString `json:"reply_id,omitempty"`
	ConversationID TweetIDString `json:"conversation_id,omitempty"`
	Date           string        `json:"date"`
	Author         Author        `json:"author"`
	Content        string        `json:"content"`
	Lang           string        `json:"lang,omitempty"`
	Hashtags       []string      `json:"hashtags,omitempty"`
	FavoriteCount  int           `json:"favorite_count"`
	RetweetCount   int           `json:"retweet_count"`
	QuoteCount     int           `json:"quote_count,omitempty"`
	ReplyCount     int           `json:"reply_count,omitempty"`
	BookmarkCount  int           `json:"bookmark_count,omitempty"`
	ViewCount      int           `json:"view_count,omitempty"`
	Sensitive      bool          `json:"sensitive,omitempty"`
}

// CLIResponse represents the raw response from extractor CLI
type CLIResponse struct {
	Media     []CLIMediaItem  `json:"media"`
	Metadata  []TweetMetadata `json:"metadata"`
	Cursor    string          `json:"cursor,omitempty"`    // Cursor for resume
	Total     int             `json:"total,omitempty"`     // Total items fetched
	Completed bool            `json:"completed,omitempty"` // True if all fetched
}

// TimelineEntry represents a single media entry for frontend (converted from MediaItem)
type TimelineEntry struct {
	URL              string        `json:"url"`
	Date             string        `json:"date"`
	TweetID          TweetIDString `json:"tweet_id"`
	Type             string        `json:"type"`
	IsRetweet        bool          `json:"is_retweet"`
	Extension        string        `json:"extension"`
	Width            int           `json:"width"`
	Height           int           `json:"height"`
	Content          string        `json:"content,omitempty"`
	ViewCount        int           `json:"view_count,omitempty"`
	BookmarkCount    int           `json:"bookmark_count,omitempty"`
	FavoriteCount    int           `json:"favorite_count,omitempty"`
	RetweetCount     int           `json:"retweet_count,omitempty"`
	ReplyCount       int           `json:"reply_count,omitempty"`
	Source           string        `json:"source,omitempty"`
	Verified         bool          `json:"verified,omitempty"`
	OriginalFilename string        `json:"original_filename,omitempty"` // Original filename from API
	AuthorUsername   string        `json:"author_username,omitempty"`   // Username of tweet author (for bookmarks and likes)
}

// AccountInfo represents Twitter account information (derived from metadata)
type AccountInfo struct {
	Name           string `json:"name"`
	Nick           string `json:"nick"`
	Date           string `json:"date"`
	FollowersCount int    `json:"followers_count"`
	FriendsCount   int    `json:"friends_count"`
	ProfileImage   string `json:"profile_image"`
	StatusesCount  int    `json:"statuses_count"`
}

// ExtractMetadata represents extraction metadata
type ExtractMetadata struct {
	NewEntries int    `json:"new_entries"`
	Page       int    `json:"page"`
	BatchSize  int    `json:"batch_size"`
	HasMore    bool   `json:"has_more"`
	Cursor     string `json:"cursor,omitempty"`    // Cursor for resume capability
	Completed  bool   `json:"completed,omitempty"` // True if all media fetched
}

// TwitterResponse represents the full response for frontend
type TwitterResponse struct {
	AccountInfo AccountInfo     `json:"account_info"`
	TotalURLs   int             `json:"total_urls"`
	Timeline    []TimelineEntry `json:"timeline"`
	Metadata    ExtractMetadata `json:"metadata"`
	Cursor      string          `json:"cursor,omitempty"`    // Cursor for next fetch
	Completed   bool            `json:"completed,omitempty"` // True if fetch completed
}

// TimelineRequest represents request parameters for timeline extraction
type TimelineRequest struct {
	Username     string `json:"username"`
	AuthToken    string `json:"auth_token"`
	TimelineType string `json:"timeline_type"` // media, timeline, tweets, with_replies, likes, bookmarks
	BatchSize    int    `json:"batch_size"`    // 0 = all
	Page         int    `json:"page"`
	MediaType    string `json:"media_type"` // all, image, video, gif
	Retweets     bool   `json:"retweets"`
	RequestID    string `json:"request_id,omitempty"`
	Cursor       string `json:"cursor,omitempty"` // Resume from this cursor position
}

// DateRangeRequest represents request parameters for date range extraction
type DateRangeRequest struct {
	Username    string `json:"username"`
	AuthToken   string `json:"auth_token"`
	StartDate   string `json:"start_date"` // YYYY-MM-DD
	EndDate     string `json:"end_date"`   // YYYY-MM-DD
	MediaFilter string `json:"media_filter"`
	Retweets    bool   `json:"retweets"`
	RequestID   string `json:"request_id,omitempty"`
}

type extractorWorkerPayload struct {
	URL        string   `json:"url"`
	AuthToken  string   `json:"auth_token,omitempty"`
	Guest      bool     `json:"guest,omitempty"`
	Retweets   string   `json:"retweets,omitempty"`
	NoVideos   bool     `json:"no_videos,omitempty"`
	Size       string   `json:"size,omitempty"`
	Limit      int      `json:"limit,omitempty"`
	Metadata   bool     `json:"metadata,omitempty"`
	TextTweets bool     `json:"text_tweets,omitempty"`
	Type       string   `json:"type,omitempty"`
	Verbose    bool     `json:"verbose,omitempty"`
	Set        []string `json:"set,omitempty"`
	Cursor     string   `json:"cursor,omitempty"`
}

type extractorWorkerRequest struct {
	ID      string                 `json:"id"`
	Request extractorWorkerPayload `json:"request"`
}

type extractorWorkerResponse struct {
	ID     string          `json:"id"`
	OK     bool            `json:"ok"`
	Result json.RawMessage `json:"result,omitempty"`
	Error  string          `json:"error,omitempty"`
}
