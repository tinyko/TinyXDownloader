package backend

import (
	"fmt"
	"net/url"
	"path/filepath"
	"strings"
	"time"
)

func resolveDownloadUsername(item MediaItem, fallbackUsername string) string {
	itemUsername := strings.TrimSpace(item.Username)
	if itemUsername != "" {
		return itemUsername
	}
	return strings.TrimSpace(fallbackUsername)
}

func mediaSubfolder(mediaType string) string {
	switch mediaType {
	case "photo":
		return "images"
	case "video":
		return "videos"
	case "gif", "animated_gif":
		return "gifs"
	case "text":
		return "texts"
	default:
		return "other"
	}
}

func nextMediaIndex(tweetMediaCount map[string]map[int64]int, username string, tweetID int64) int {
	if tweetMediaCount[username] == nil {
		tweetMediaCount[username] = make(map[int64]int)
	}
	tweetMediaCount[username][tweetID]++
	return tweetMediaCount[username][tweetID]
}

func buildMediaFilename(item MediaItem, username string, mediaIndex int) string {
	timestamp := formatTimestamp(item.Date)
	ext := getExtension(item.URL, item.Type)
	return fmt.Sprintf("%s_%s_%d_%02d%s", username, timestamp, item.TweetID, mediaIndex, ext)
}

func formatTimestamp(dateStr string) string {
	formats := []string{
		"2006-01-02T15:04:05",
		"2006-01-02T15:04:05+00:00",
		"2006-01-02T15:04:05-07:00",
		time.RFC3339,
		"2006-01-02T15:04:05.000Z",
		"2006-01-02T15:04:05Z",
		"2006-01-02 15:04:05",
		"Mon Jan 02 15:04:05 -0700 2006",
	}

	for _, format := range formats {
		if t, err := time.Parse(format, dateStr); err == nil {
			return t.Format("20060102_150405")
		}
	}

	return "00000000_000000"
}

func getExtension(mediaURL string, mediaType string) string {
	parsedURL, err := url.Parse(mediaURL)
	if err != nil {
		return ".jpg"
	}

	if format := parsedURL.Query().Get("format"); format != "" {
		return "." + format
	}

	path := parsedURL.Path
	ext := filepath.Ext(path)
	if ext != "" {
		return ext
	}

	switch mediaType {
	case "video":
		return ".mp4"
	case "gif", "animated_gif":
		return ".mp4"
	case "text":
		return ".txt"
	default:
		return ".jpg"
	}
}

func extractFilename(mediaURL string) string {
	parsedURL, err := url.Parse(mediaURL)
	if err != nil {
		return fmt.Sprintf("media_%d", time.Now().UnixNano())
	}

	path := parsedURL.Path
	base := filepath.Base(path)

	if strings.Contains(mediaURL, "pbs.twimg.com/media/") {
		format := parsedURL.Query().Get("format")
		if format == "" {
			format = "jpg"
		}
		if idx := strings.LastIndex(base, "."); idx > 0 {
			base = base[:idx]
		}
		return base + "." + format
	}

	if strings.Contains(mediaURL, "video.twimg.com") {
		return base
	}

	if base == "" || base == "." {
		return fmt.Sprintf("media_%d", time.Now().UnixNano())
	}

	return base
}
