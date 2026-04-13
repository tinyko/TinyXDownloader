package backend

import (
	"encoding/json"
	"fmt"
	"strings"
)

func shouldRetryAsGuest(authToken string, timelineType string, err error) bool {
	if err == nil || strings.TrimSpace(authToken) == "" {
		return false
	}

	lowerTimelineType := strings.ToLower(strings.TrimSpace(timelineType))
	if lowerTimelineType == "likes" || lowerTimelineType == "bookmarks" {
		return false
	}

	lowerErr := strings.ToLower(err.Error())
	return strings.Contains(lowerErr, "matching csrf cookie and header") ||
		strings.Contains(lowerErr, "csrf cookie and header") ||
		(strings.Contains(lowerErr, "403 forbidden") && strings.Contains(lowerErr, "csrf"))
}

func buildGuestExtractorArgs(args []string) []string {
	guestArgs := make([]string, 0, len(args))
	for i := 0; i < len(args); i++ {
		if args[i] == "--auth-token" {
			i++
			continue
		}
		if args[i] == "--guest" {
			continue
		}
		guestArgs = append(guestArgs, args[i])
	}
	return append(guestArgs, "--guest")
}

// ExtractTimeline extracts media from user timeline using the new CLI
func ExtractTimeline(req TimelineRequest) (*TwitterResponse, error) {
	// Get or extract extractor binary (persistent, not temp)
	exePath, err := ensureExtractor()
	if err != nil {
		return nil, err
	}

	// Determine the right endpoint based on what user wants:
	// - Media (all/image/video/gif): Use /media endpoint - fastest and most reliable
	// - Text tweets: Use /tweets endpoint with --text-tweets
	// - With retweets: Use /tweets endpoint (retweets not available on /media)
	isTextOnly := req.MediaType == "text"
	wantsRetweets := req.Retweets

	timelineType := req.TimelineType
	if timelineType == "" {
		if isTextOnly {
			// Text-only tweets need /tweets endpoint
			timelineType = "tweets"
		} else if wantsRetweets {
			// Retweets need /tweets endpoint (not available on /media)
			timelineType = "tweets"
		} else {
			// Default: /media endpoint - fastest for media-only fetch
			timelineType = "media"
		}
	}

	url := buildTwitterURL(req.Username, timelineType)

	// Build command arguments for new CLI format
	// Format: extractor.exe URL --auth-token TOKEN --json [options]
	args := []string{url}
	payload := extractorWorkerPayload{
		URL:       url,
		AuthToken: req.AuthToken,
		Guest:     req.AuthToken == "",
		Retweets:  "skip",
		Size:      "orig",
		Limit:     req.BatchSize,
		Metadata:  true,
		Type:      "all",
		Cursor:    req.Cursor,
	}

	// Add auth token
	if req.AuthToken != "" {
		args = append(args, "--auth-token", req.AuthToken)
	} else {
		args = append(args, "--guest")
	}

	// Always request JSON output with metadata
	args = append(args, "--json", "--metadata")

	// Add limit if specified
	if req.BatchSize > 0 {
		args = append(args, "--limit", fmt.Sprintf("%d", req.BatchSize))
	}

	// Handle retweets - only relevant when using /tweets endpoint
	if timelineType == "tweets" || timelineType == "timeline" {
		if req.Retweets {
			args = append(args, "--retweets", "include")
			payload.Retweets = "include"
		} else {
			args = append(args, "--retweets", "skip")
			payload.Retweets = "skip"
		}
	}

	// Only add --text-tweets when explicitly requesting text content
	if isTextOnly {
		args = append(args, "--text-tweets")
		payload.TextTweets = true
	}

	// Handle media type filter using --type parameter
	if req.MediaType != "" && req.MediaType != "all" && !isTextOnly {
		switch req.MediaType {
		case "image":
			args = append(args, "--type", "photo")
			payload.Type = "photo"
		case "video":
			args = append(args, "--type", "video")
			payload.Type = "video"
		case "gif":
			args = append(args, "--type", "animated_gif")
			payload.Type = "animated_gif"
		}
	}

	// Add cursor for resume capability
	if req.Cursor != "" {
		args = append(args, "--cursor", req.Cursor)
	}

	output, err := executeExtractorRequest(exePath, req.RequestID, payload, args, req.Username)
	if shouldRetryAsGuest(req.AuthToken, timelineType, err) {
		guestPayload := payload
		guestPayload.AuthToken = ""
		guestPayload.Guest = true
		output, err = executeExtractorRequest(
			exePath,
			req.RequestID,
			guestPayload,
			buildGuestExtractorArgs(args),
			req.Username,
		)
	}
	if err != nil {
		return nil, err
	}

	// Find JSON in output (skip any info messages)
	jsonStr := extractJSON(string(output))
	if jsonStr == "" {
		outputStr := string(output)
		if strings.TrimSpace(outputStr) == "" {
			return nil, fmt.Errorf("empty_response: Extractor returned no data. The timeline may be empty or inaccessible")
		}
		return nil, fmt.Errorf("parse_error: Could not parse extractor output. Raw output: %s", outputStr)
	}

	// Parse CLI response
	var cliResponse CLIResponse
	if err := json.Unmarshal([]byte(jsonStr), &cliResponse); err != nil {
		return nil, fmt.Errorf("json_error: Failed to parse JSON response: %v", err)
	}

	// Convert to frontend format
	var timeline []TimelineEntry
	accountInfo := AccountInfo{
		Name: req.Username,
		Nick: req.Username,
	}

	// Build a set of tweet IDs that have media
	mediaTweetIDs := make(map[int64]bool)
	for _, media := range cliResponse.Media {
		mediaTweetIDs[int64(media.TweetID)] = true
	}

	// For bookmarks and likes, keep name as "bookmarks"/"likes" (not from author tweet)
	isBookmarks := req.TimelineType == "bookmarks"
	isLikes := req.TimelineType == "likes"
	if isBookmarks {
		accountInfo.Name = "bookmarks"
		accountInfo.Nick = "My Bookmarks"
	} else if isLikes {
		accountInfo.Name = "likes"
		accountInfo.Nick = "My Likes"
	}

	if isTextOnly {
		// Text-only mode: get tweets from metadata that don't have media
		timeline = make([]TimelineEntry, 0)
		for _, meta := range cliResponse.Metadata {
			if !mediaTweetIDs[int64(meta.TweetID)] {
				timeline = append(timeline, convertMetadataToTimelineEntry(meta))
			}
		}

		// Get account info from first media item if available, otherwise from metadata
		if !isBookmarks && !isLikes {
			if len(cliResponse.Media) > 0 {
				user := cliResponse.Media[0].User
				accountInfo.Name = user.Name
				accountInfo.Nick = user.Nick
				accountInfo.Date = user.Date
				accountInfo.FollowersCount = user.FollowersCount
				accountInfo.FriendsCount = user.FriendsCount
				accountInfo.ProfileImage = user.ProfileImage
				accountInfo.StatusesCount = user.StatusesCount
			} else if len(cliResponse.Metadata) > 0 {
				firstMeta := cliResponse.Metadata[0]
				accountInfo.Name = firstMeta.Author.Name
				accountInfo.Nick = firstMeta.Author.Nick
			}
		} else {
			// For bookmarks and likes, get other info from first media item if available
			if len(cliResponse.Media) > 0 {
				user := cliResponse.Media[0].User
				accountInfo.Date = user.Date
				accountInfo.FollowersCount = user.FollowersCount
				accountInfo.FriendsCount = user.FriendsCount
				accountInfo.ProfileImage = user.ProfileImage
				accountInfo.StatusesCount = user.StatusesCount
			}
		}
	} else if len(cliResponse.Media) > 0 {
		// Normal media items only (text tweets handled separately with "text" media type)
		timeline = make([]TimelineEntry, 0, len(cliResponse.Media))

		// Add media items
		for _, media := range cliResponse.Media {
			timeline = append(timeline, convertToTimelineEntry(media))
		}

		// Get account info from first media item
		user := cliResponse.Media[0].User
		if !isBookmarks && !isLikes {
			accountInfo.Name = user.Name
			accountInfo.Nick = user.Nick
		}
		accountInfo.Date = user.Date
		accountInfo.FollowersCount = user.FollowersCount
		accountInfo.FriendsCount = user.FriendsCount
		accountInfo.ProfileImage = user.ProfileImage
		accountInfo.StatusesCount = user.StatusesCount
	} else if len(cliResponse.Metadata) > 0 {
		// Fallback: Text-only tweets (no media) - convert metadata to timeline entries
		timeline = make([]TimelineEntry, 0, len(cliResponse.Metadata))
		for _, meta := range cliResponse.Metadata {
			entry := TimelineEntry{
				URL:            "", // No media URL for text tweets
				TweetID:        meta.TweetID,
				Date:           meta.Date,
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
			timeline = append(timeline, entry)
		}
		// Get account info from first metadata
		if !isBookmarks && !isLikes {
			firstMeta := cliResponse.Metadata[0]
			accountInfo.Name = firstMeta.Author.Name
			accountInfo.Nick = firstMeta.Author.Nick
		}
	}

	// Determine if there's more data to fetch
	hasMore := cliResponse.Cursor != "" && !cliResponse.Completed

	response := &TwitterResponse{
		AccountInfo: accountInfo,
		TotalURLs:   len(timeline),
		Timeline:    timeline,
		Metadata: ExtractMetadata{
			NewEntries: len(timeline),
			Page:       req.Page,
			BatchSize:  req.BatchSize,
			HasMore:    hasMore,
			Cursor:     cliResponse.Cursor,
			Completed:  cliResponse.Completed,
		},
		Cursor:    cliResponse.Cursor,
		Completed: cliResponse.Completed,
	}

	return response, nil
}

// ExtractDateRange extracts media based on date range using the new CLI
func ExtractDateRange(req DateRangeRequest) (*TwitterResponse, error) {
	// Get or extract extractor binary (persistent, not temp)
	exePath, err := ensureExtractor()
	if err != nil {
		return nil, err
	}

	mediaFilter := strings.ToLower(strings.TrimSpace(req.MediaFilter))
	url := buildSearchURL(req.Username, req.StartDate, req.EndDate, mediaFilter, req.Retweets)

	// Build command arguments
	args := []string{url}
	payload := extractorWorkerPayload{
		URL:        url,
		AuthToken:  req.AuthToken,
		Guest:      req.AuthToken == "",
		Retweets:   "skip",
		Size:       "orig",
		Metadata:   true,
		TextTweets: mediaFilter == "text",
		Type:       "all",
	}

	// Add auth token
	if req.AuthToken != "" {
		args = append(args, "--auth-token", req.AuthToken)
	} else {
		args = append(args, "--guest")
	}

	// Always request JSON output with metadata
	args = append(args, "--json", "--metadata")

	if req.Retweets {
		args = append(args, "--retweets", "include")
		payload.Retweets = "include"
	} else {
		args = append(args, "--retweets", "skip")
		payload.Retweets = "skip"
	}

	isTextOnly := mediaFilter == "text"
	if isTextOnly {
		args = append(args, "--text-tweets")
	} else {
		switch mediaFilter {
		case "image":
			payload.Type = "photo"
		case "video":
			payload.Type = "video"
		case "gif":
			payload.Type = "animated_gif"
		}
	}

	output, err := executeExtractorRequest(exePath, req.RequestID, payload, args, req.Username)
	if shouldRetryAsGuest(req.AuthToken, "search", err) {
		guestPayload := payload
		guestPayload.AuthToken = ""
		guestPayload.Guest = true
		output, err = executeExtractorRequest(
			exePath,
			req.RequestID,
			guestPayload,
			buildGuestExtractorArgs(args),
			req.Username,
		)
	}
	if err != nil {
		return nil, err
	}

	// Find JSON in output (skip any info messages)
	jsonStr := extractJSON(string(output))
	if jsonStr == "" {
		outputStr := string(output)
		if strings.TrimSpace(outputStr) == "" {
			return nil, fmt.Errorf("empty_response: Extractor returned no data. The timeline may be empty or inaccessible")
		}
		return nil, fmt.Errorf("parse_error: Could not parse extractor output. Raw output: %s", outputStr)
	}

	// Parse CLI response
	var cliResponse CLIResponse
	if err := json.Unmarshal([]byte(jsonStr), &cliResponse); err != nil {
		return nil, fmt.Errorf("json_error: Failed to parse JSON response: %v", err)
	}

	// Convert to frontend format
	mediaTweetIDs := make(map[int64]bool)
	for _, media := range cliResponse.Media {
		mediaTweetIDs[int64(media.TweetID)] = true
	}

	timeline := make([]TimelineEntry, 0, len(cliResponse.Media)+len(cliResponse.Metadata))
	for _, media := range cliResponse.Media {
		timeline = append(timeline, convertToTimelineEntry(media))
	}

	if isTextOnly {
		for _, meta := range cliResponse.Metadata {
			if !mediaTweetIDs[int64(meta.TweetID)] {
				timeline = append(timeline, convertMetadataToTimelineEntry(meta))
			}
		}
	}

	// Build account info from first media item (has full user info)
	accountInfo := AccountInfo{
		Name: req.Username,
		Nick: req.Username,
	}
	if len(cliResponse.Media) > 0 {
		user := cliResponse.Media[0].User
		accountInfo.Name = user.Name
		accountInfo.Nick = user.Nick
		accountInfo.Date = user.Date
		accountInfo.FollowersCount = user.FollowersCount
		accountInfo.FriendsCount = user.FriendsCount
		accountInfo.ProfileImage = user.ProfileImage
		accountInfo.StatusesCount = user.StatusesCount
	} else if len(cliResponse.Metadata) > 0 {
		firstMeta := cliResponse.Metadata[0]
		accountInfo.Name = firstMeta.Author.Name
		accountInfo.Nick = firstMeta.Author.Nick
	}

	// Determine if there's more data to fetch
	hasMore := cliResponse.Cursor != "" && !cliResponse.Completed

	response := &TwitterResponse{
		AccountInfo: accountInfo,
		TotalURLs:   len(timeline),
		Timeline:    timeline,
		Metadata: ExtractMetadata{
			NewEntries: len(timeline),
			Page:       0,
			BatchSize:  0,
			HasMore:    hasMore,
			Cursor:     cliResponse.Cursor,
			Completed:  cliResponse.Completed,
		},
		Cursor:    cliResponse.Cursor,
		Completed: cliResponse.Completed,
	}

	return response, nil
}

// extractJSON finds and extracts JSON object from output string
