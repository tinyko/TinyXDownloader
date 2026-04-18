package backend

import "time"

const (
	MaxConcurrentDownloads      = 10
	MaxConcurrentImageDownloads = 8
	MaxConcurrentVideoDownloads = 3
	partialDownloadSuffix       = ".part"
	downloadRequestTimeout      = 30 * time.Minute
	downloadConnectTimeout      = 15 * time.Second
	downloadResponseHeaderWait  = 30 * time.Second
	downloadRetryAttempts       = 5
)

// MediaItem represents a media item with metadata for download.
type MediaItem struct {
	URL              string `json:"url"`
	Date             string `json:"date"`
	TweetID          int64  `json:"tweet_id"`
	Type             string `json:"type"`
	Username         string `json:"username"`
	Content          string `json:"content,omitempty"`
	OriginalFilename string `json:"original_filename,omitempty"`
}

// ProgressCallback reports overall task progress.
type ProgressCallback func(current, total int)

// ItemStatusCallback reports per-item status updates.
type ItemStatusCallback func(item MediaItem, index int, status string, errorMessage string)

type downloadTask struct {
	item       MediaItem
	outputPath string
	index      int
}
