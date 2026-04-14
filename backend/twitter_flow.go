package backend

import (
	"encoding/json"
	"fmt"
	"strings"
)

type extractorRequestSpec struct {
	username       string
	args           []string
	payload        extractorWorkerPayload
	guestRetryType string
	timelineType   string
	textOnly       bool
	page           int
	batchSize      int
}

func buildTimelineExtractorSpec(req TimelineRequest) extractorRequestSpec {
	isTextOnly := req.MediaType == "text"
	wantsRetweets := req.Retweets

	timelineType := req.TimelineType
	if timelineType == "" {
		switch {
		case isTextOnly:
			timelineType = "tweets"
		case wantsRetweets:
			timelineType = "tweets"
		default:
			timelineType = "media"
		}
	}

	url := buildTwitterURL(req.Username, timelineType)
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

	if req.AuthToken != "" {
		args = append(args, "--auth-token", req.AuthToken)
	} else {
		args = append(args, "--guest")
	}

	args = append(args, "--json", "--metadata")

	if req.BatchSize > 0 {
		args = append(args, "--limit", fmt.Sprintf("%d", req.BatchSize))
	}

	if timelineType == "tweets" || timelineType == "timeline" {
		if req.Retweets {
			args = append(args, "--retweets", "include")
			payload.Retweets = "include"
		} else {
			args = append(args, "--retweets", "skip")
			payload.Retweets = "skip"
		}
	}

	if isTextOnly {
		args = append(args, "--text-tweets")
		payload.TextTweets = true
	}

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

	if req.Cursor != "" {
		args = append(args, "--cursor", req.Cursor)
	}

	return extractorRequestSpec{
		username:       req.Username,
		args:           args,
		payload:        payload,
		guestRetryType: timelineType,
		timelineType:   timelineType,
		textOnly:       isTextOnly,
		page:           req.Page,
		batchSize:      req.BatchSize,
	}
}

func buildDateRangeExtractorSpec(req DateRangeRequest) extractorRequestSpec {
	mediaFilter := strings.ToLower(strings.TrimSpace(req.MediaFilter))
	url := buildSearchURL(req.Username, req.StartDate, req.EndDate, mediaFilter, req.Retweets)

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

	if req.AuthToken != "" {
		args = append(args, "--auth-token", req.AuthToken)
	} else {
		args = append(args, "--guest")
	}

	args = append(args, "--json", "--metadata")

	if req.Retweets {
		args = append(args, "--retweets", "include")
		payload.Retweets = "include"
	} else {
		args = append(args, "--retweets", "skip")
		payload.Retweets = "skip"
	}

	switch mediaFilter {
	case "text":
		args = append(args, "--text-tweets")
	case "image":
		payload.Type = "photo"
	case "video":
		payload.Type = "video"
	case "gif":
		payload.Type = "animated_gif"
	}

	return extractorRequestSpec{
		username:       req.Username,
		args:           args,
		payload:        payload,
		guestRetryType: "search",
		timelineType:   "search",
		textOnly:       mediaFilter == "text",
	}
}

func executeExtractorSpec(exePath string, requestID string, spec extractorRequestSpec) (*CLIResponse, error) {
	output, err := executeExtractorRequest(exePath, requestID, spec.payload, spec.args, spec.username)
	if shouldRetryAsGuest(spec.payload.AuthToken, spec.guestRetryType, err) {
		guestPayload := spec.payload
		guestPayload.AuthToken = ""
		guestPayload.Guest = true
		output, err = executeExtractorRequest(
			exePath,
			requestID,
			guestPayload,
			buildGuestExtractorArgs(spec.args),
			spec.username,
		)
	}
	if err != nil {
		return nil, err
	}

	return decodeCLIResponseOutput(output)
}

func decodeCLIResponseOutput(output []byte) (*CLIResponse, error) {
	jsonStr := extractJSON(string(output))
	if jsonStr == "" {
		outputStr := string(output)
		if strings.TrimSpace(outputStr) == "" {
			return nil, fmt.Errorf("empty_response: Extractor returned no data. The timeline may be empty or inaccessible")
		}
		return nil, fmt.Errorf("parse_error: Could not parse extractor output. Raw output: %s", outputStr)
	}

	var cliResponse CLIResponse
	if err := json.Unmarshal([]byte(jsonStr), &cliResponse); err != nil {
		return nil, fmt.Errorf("json_error: Failed to parse JSON response: %v", err)
	}

	return &cliResponse, nil
}

func buildTimelineResponseFromCLIResponse(req TimelineRequest, spec extractorRequestSpec, cliResponse *CLIResponse) *TwitterResponse {
	timeline := buildTimelineEntriesFromCLIResponse(cliResponse, spec.textOnly)
	accountInfo := buildTimelineAccountInfo(req.Username, spec.timelineType, cliResponse, spec.textOnly)
	return buildTwitterResponse(accountInfo, timeline, spec.page, spec.batchSize, cliResponse.Cursor, cliResponse.Completed)
}

func buildDateRangeResponseFromCLIResponse(req DateRangeRequest, spec extractorRequestSpec, cliResponse *CLIResponse) *TwitterResponse {
	timeline := buildSearchTimelineEntriesFromCLIResponse(cliResponse, spec.textOnly)
	accountInfo := buildSearchAccountInfo(req.Username, cliResponse)
	return buildTwitterResponse(accountInfo, timeline, 0, 0, cliResponse.Cursor, cliResponse.Completed)
}

func buildTimelineEntriesFromCLIResponse(cliResponse *CLIResponse, textOnly bool) []TimelineEntry {
	mediaTweetIDs := collectMediaTweetIDs(cliResponse)

	switch {
	case textOnly:
		timeline := make([]TimelineEntry, 0, len(cliResponse.Metadata))
		for _, meta := range cliResponse.Metadata {
			if !mediaTweetIDs[int64(meta.TweetID)] {
				timeline = append(timeline, convertMetadataToTimelineEntry(meta))
			}
		}
		return timeline
	case len(cliResponse.Media) > 0:
		timeline := make([]TimelineEntry, 0, len(cliResponse.Media))
		for _, media := range cliResponse.Media {
			timeline = append(timeline, convertToTimelineEntry(media))
		}
		return timeline
	default:
		timeline := make([]TimelineEntry, 0, len(cliResponse.Metadata))
		for _, meta := range cliResponse.Metadata {
			timeline = append(timeline, convertMetadataToTimelineEntry(meta))
		}
		return timeline
	}
}

func buildSearchTimelineEntriesFromCLIResponse(cliResponse *CLIResponse, textOnly bool) []TimelineEntry {
	timeline := make([]TimelineEntry, 0, len(cliResponse.Media)+len(cliResponse.Metadata))
	for _, media := range cliResponse.Media {
		timeline = append(timeline, convertToTimelineEntry(media))
	}

	if textOnly {
		mediaTweetIDs := collectMediaTweetIDs(cliResponse)
		for _, meta := range cliResponse.Metadata {
			if !mediaTweetIDs[int64(meta.TweetID)] {
				timeline = append(timeline, convertMetadataToTimelineEntry(meta))
			}
		}
	}

	return timeline
}

func collectMediaTweetIDs(cliResponse *CLIResponse) map[int64]bool {
	mediaTweetIDs := make(map[int64]bool, len(cliResponse.Media))
	for _, media := range cliResponse.Media {
		mediaTweetIDs[int64(media.TweetID)] = true
	}
	return mediaTweetIDs
}

func buildTimelineAccountInfo(username string, timelineType string, cliResponse *CLIResponse, textOnly bool) AccountInfo {
	isBookmarks := timelineType == "bookmarks"
	isLikes := timelineType == "likes"

	accountInfo := AccountInfo{
		Name: username,
		Nick: username,
	}

	if isBookmarks {
		accountInfo.Name = "bookmarks"
		accountInfo.Nick = "My Bookmarks"
	} else if isLikes {
		accountInfo.Name = "likes"
		accountInfo.Nick = "My Likes"
	}

	if textOnly {
		if !isBookmarks && !isLikes {
			if len(cliResponse.Media) > 0 {
				applyAccountInfoFromUser(&accountInfo, cliResponse.Media[0].User, true)
			} else if len(cliResponse.Metadata) > 0 {
				accountInfo.Name = cliResponse.Metadata[0].Author.Name
				accountInfo.Nick = cliResponse.Metadata[0].Author.Nick
			}
		} else if len(cliResponse.Media) > 0 {
			applyAccountInfoFromUser(&accountInfo, cliResponse.Media[0].User, false)
		}
		return accountInfo
	}

	if len(cliResponse.Media) > 0 {
		applyAccountInfoFromUser(&accountInfo, cliResponse.Media[0].User, !isBookmarks && !isLikes)
		return accountInfo
	}

	if len(cliResponse.Metadata) > 0 && !isBookmarks && !isLikes {
		accountInfo.Name = cliResponse.Metadata[0].Author.Name
		accountInfo.Nick = cliResponse.Metadata[0].Author.Nick
	}

	return accountInfo
}

func buildSearchAccountInfo(username string, cliResponse *CLIResponse) AccountInfo {
	accountInfo := AccountInfo{
		Name: username,
		Nick: username,
	}

	if len(cliResponse.Media) > 0 {
		applyAccountInfoFromUser(&accountInfo, cliResponse.Media[0].User, true)
	} else if len(cliResponse.Metadata) > 0 {
		accountInfo.Name = cliResponse.Metadata[0].Author.Name
		accountInfo.Nick = cliResponse.Metadata[0].Author.Nick
	}

	return accountInfo
}

func applyAccountInfoFromUser(accountInfo *AccountInfo, user UserInfo, updateNames bool) {
	if accountInfo == nil {
		return
	}

	if updateNames {
		accountInfo.Name = user.Name
		accountInfo.Nick = user.Nick
	}
	accountInfo.Date = user.Date
	accountInfo.FollowersCount = user.FollowersCount
	accountInfo.FriendsCount = user.FriendsCount
	accountInfo.ProfileImage = user.ProfileImage
	accountInfo.StatusesCount = user.StatusesCount
}

func buildTwitterResponse(accountInfo AccountInfo, timeline []TimelineEntry, page int, batchSize int, cursor string, completed bool) *TwitterResponse {
	hasMore := cursor != "" && !completed
	return &TwitterResponse{
		AccountInfo: accountInfo,
		TotalURLs:   len(timeline),
		Timeline:    timeline,
		Metadata: ExtractMetadata{
			NewEntries: len(timeline),
			Page:       page,
			BatchSize:  batchSize,
			HasMore:    hasMore,
			Cursor:     cursor,
			Completed:  completed,
		},
		Cursor:    cursor,
		Completed: completed,
	}
}
