package backend

import "strings"

func convertMetadataToTimelineEntry(meta TweetMetadata) TimelineEntry {
	return TimelineEntry{
		URL:            "",
		Date:           meta.Date,
		TweetID:        meta.TweetID,
		Type:           "text",
		IsRetweet:      meta.RetweetID != 0,
		Extension:      "txt",
		Width:          0,
		Height:         0,
		Content:        meta.Content,
		ViewCount:      meta.ViewCount,
		BookmarkCount:  meta.BookmarkCount,
		FavoriteCount:  meta.FavoriteCount,
		RetweetCount:   meta.RetweetCount,
		ReplyCount:     meta.ReplyCount,
		AuthorUsername: meta.Author.Name,
	}
}

// convertToTimelineEntry converts CLIMediaItem to TimelineEntry
func convertToTimelineEntry(media CLIMediaItem) TimelineEntry {
	// Get username from Author field (preferred for bookmarks/likes) or User field
	// Author field always contains the tweet author, while User might be the account fetching for likes
	authorUsername := ""
	if media.Author.Name != "" {
		authorUsername = media.Author.Name
	} else if media.User.Name != "" {
		authorUsername = media.User.Name
	}

	entry := TimelineEntry{
		URL:            media.URL,
		TweetID:        media.TweetID,
		Date:           media.Date,
		Extension:      media.Extension,
		Width:          media.Width,
		Height:         media.Height,
		IsRetweet:      media.RetweetID != 0,
		Content:        media.Content,
		ViewCount:      media.ViewCount,
		BookmarkCount:  media.BookmarkCount,
		FavoriteCount:  media.FavoriteCount,
		RetweetCount:   media.RetweetCount,
		ReplyCount:     media.ReplyCount,
		Source:         media.Source,
		Verified:       media.Author.Verified,
		AuthorUsername: authorUsername,
		// OriginalFilename will be extracted from URL in download.go
	}

	// Determine type - media item already has type from CLI
	if media.Type != "" {
		entry.Type = media.Type
	} else {
		switch strings.ToLower(media.Extension) {
		case "mp4", "webm":
			entry.Type = "video"
		case "gif":
			entry.Type = "gif"
		default:
			entry.Type = "photo"
		}
	}

	return entry
}
