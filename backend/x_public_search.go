package backend

import (
	"context"
	"encoding/json"
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"time"
)

const xDateRangeSearchCount = 20

var xSearchMaxIDPattern = regexp.MustCompile(`\bmax_id:\d+`)

type xPublicSearchDiagnosticLogEntry struct {
	Event          string `json:"event"`
	Username       string `json:"username,omitempty"`
	MediaFilter    string `json:"media_filter,omitempty"`
	AuthMode       string `json:"auth_mode,omitempty"`
	Stage          string `json:"stage,omitempty"`
	FallbackCode   string `json:"fallback_code,omitempty"`
	PageCount      int    `json:"page_count,omitempty"`
	TweetCount     int    `json:"tweet_count,omitempty"`
	MediaItemCount int    `json:"media_item_count,omitempty"`
	TextItemCount  int    `json:"text_item_count,omitempty"`
	PartialParse   bool   `json:"partial_parse"`
	Success        bool   `json:"success"`
	ElapsedMS      int64  `json:"elapsed_ms"`
	Error          string `json:"error,omitempty"`
}

func (c *xAPIClient) extractPublicSearchDateRange(ctx context.Context, req DateRangeRequest) (response *TwitterResponse, err error) {
	startedAt := time.Now()
	normalizedFilter := xNormalizeDateRangeMediaFilter(req.MediaFilter)
	logEntry := xPublicSearchDiagnosticLogEntry{
		Event:       "x_public_search_request",
		Username:    cleanUsername(req.Username),
		MediaFilter: normalizedFilter,
		AuthMode:    xAuthMode(req.AuthToken),
		Stage:       "lookup",
	}

	defer func() {
		logEntry.ElapsedMS = time.Since(startedAt).Milliseconds()
		logEntry.Success = err == nil
		if err != nil {
			logEntry.Error = errorString(err)
			if metadata, ok := xFallbackDetails(err); ok {
				logEntry.Stage = metadata.Stage
				logEntry.FallbackCode = metadata.Code
				logEntry.PartialParse = metadata.PartialParse
			}
		}
		appendXPublicSearchDiagnosticLog(logEntry)
	}()

	query, err := xBuildPublicDateRangeQuery(req)
	if err != nil {
		return nil, err
	}

	session, err := c.newSession(strings.TrimSpace(req.AuthToken))
	if err != nil {
		return nil, err
	}

	username := cleanUsername(req.Username)
	var user xUserResult
	userFound := false
	if username != "" {
		lookupUser, lookupErr := session.resolveUserByScreenName(ctx, username)
		if lookupErr == nil {
			user = lookupUser
			userFound = true
		}
	}

	filter := xNormalizeRequestedMediaType(req.MediaFilter)
	textOnly := strings.EqualFold(strings.TrimSpace(req.MediaFilter), "text")
	if textOnly {
		filter = "all"
	}

	logEntry.Stage = "fetch"
	parsed, pageCount, fetchErr := session.fetchSearchTimelineAll(ctx, query, xDateRangeSearchCount, xTimelineParseOptions{
		Filter:          filter,
		IncludeRetweets: req.Retweets,
		TextOnly:        textOnly,
	})
	logEntry.PageCount = pageCount
	if fetchErr != nil {
		err = fetchErr
		return nil, err
	}
	if parsed != nil {
		logEntry.Stage = "normalize"
		logEntry.TweetCount = parsed.RawTweetCount
		logEntry.MediaItemCount = len(parsed.Media)
	}

	response, err = buildPublicSearchDateRangeResponse(req, parsed, user, userFound)
	if err != nil {
		return nil, err
	}
	logEntry.TextItemCount = xCountTimelineEntryType(response.Timeline, "text")
	return response, nil
}

func (s *xAPISession) fetchSearchTimelineAll(
	ctx context.Context,
	rawQuery string,
	count int,
	options xTimelineParseOptions,
) (*xParsedTimelinePage, int, error) {
	combined := &xParsedTimelinePage{
		Media:    make([]CLIMediaItem, 0, 32),
		Metadata: make([]TweetMetadata, 0, 32),
	}
	pageCount := 0
	currentQuery := strings.TrimSpace(rawQuery)
	currentCursor := ""
	stopTweets := xSearchTimelineStopTweets

	for {
		envelope, err := s.fetchSearchTimelinePage(ctx, currentQuery, count, currentCursor)
		if err != nil {
			return nil, pageCount, err
		}
		pageCount++

		page, err := parseXTimelinePage(envelope.Data.SearchByRawQuery.SearchTimeline.Timeline.Instructions, options)
		if err != nil {
			if combined.RawTweetCount > 0 || len(combined.Media) > 0 || len(combined.Metadata) > 0 {
				err = xMarkPartialParse(err)
			}
			return nil, pageCount, err
		}

		xMergeParsedTimelinePage(combined, page)
		tweetFound := page.RawTweetCount > 0
		if tweetFound {
			stopTweets = xSearchTimelineStopTweets
		} else if stopTweets <= 0 {
			return combined, pageCount, nil
		} else {
			stopTweets--
		}

		nextCursor := strings.TrimSpace(page.Cursor)
		if nextCursor == "" || nextCursor == currentCursor {
			return combined, pageCount, nil
		}

		currentQuery, currentCursor = xAdvanceSearchTimelinePagination(currentQuery, nextCursor, page.LastTweetID)
	}
}

func xBuildPublicDateRangeQuery(req DateRangeRequest) (string, error) {
	if xIsRawSearchRequest(req.Username) {
		return "", newEngineUnsupportedError("go-twitter", "go public date-range extractor only supports username-based requests")
	}

	mediaFilter := xNormalizeDateRangeMediaFilter(req.MediaFilter)
	if mediaFilter == "" {
		return "", newEngineUnsupportedError("go-twitter", "go public date-range extractor only supports all|image|video|gif|text")
	}

	handle := cleanUsername(req.Username)
	if handle == "" {
		return "", newEngineUnsupportedError("go-twitter", "go public date-range extractor requires a username")
	}

	parts := []string{fmt.Sprintf("from:%s", handle)}
	if startDate := strings.TrimSpace(req.StartDate); startDate != "" {
		parts = append(parts, fmt.Sprintf("since:%s", startDate))
	}
	if endDate := strings.TrimSpace(req.EndDate); endDate != "" {
		parts = append(parts, fmt.Sprintf("until:%s", endDate))
	}

	switch mediaFilter {
	case "all":
		parts = append(parts, "filter:media")
	case "image":
		parts = append(parts, "filter:images")
	case "video", "gif":
		parts = append(parts, "filter:videos")
	case "text":
		parts = append(parts, "-filter:media")
	}

	if !req.Retweets {
		parts = append(parts, "-filter:retweets")
	}

	return strings.Join(parts, " "), nil
}

func xNormalizeDateRangeMediaFilter(mediaFilter string) string {
	switch strings.ToLower(strings.TrimSpace(mediaFilter)) {
	case "", "all":
		return "all"
	case "image":
		return "image"
	case "video":
		return "video"
	case "gif":
		return "gif"
	case "text":
		return "text"
	default:
		return ""
	}
}

func xIsRawSearchRequest(username string) bool {
	lower := strings.ToLower(strings.TrimSpace(username))
	return strings.Contains(lower, "/search?") || strings.Contains(lower, "search?q=")
}

func xAdvanceSearchTimelinePagination(rawQuery string, cursor string, lastTweetID string) (string, string) {
	if nextQuery, ok := xUpdateSearchQueryMaxID(rawQuery, lastTweetID); ok {
		return nextQuery, ""
	}
	return strings.TrimSpace(rawQuery), strings.TrimSpace(cursor)
}

func xUpdateSearchQueryMaxID(rawQuery string, lastTweetID string) (string, bool) {
	tweetID, err := strconv.ParseInt(strings.TrimSpace(lastTweetID), 10, 64)
	if err != nil || tweetID <= 0 {
		return "", false
	}

	maxID := fmt.Sprintf("max_id:%d", tweetID-1)
	trimmedQuery := strings.TrimSpace(rawQuery)
	if xSearchMaxIDPattern.MatchString(trimmedQuery) {
		return strings.TrimSpace(xSearchMaxIDPattern.ReplaceAllString(trimmedQuery, maxID)), true
	}
	if trimmedQuery == "" {
		return maxID, true
	}
	return strings.TrimSpace(trimmedQuery + " " + maxID), true
}

func buildPublicSearchDateRangeResponse(
	req DateRangeRequest,
	parsed *xParsedTimelinePage,
	user xUserResult,
	userFound bool,
) (*TwitterResponse, error) {
	if parsed == nil {
		return nil, xWrapFallback("normalize", "nil_parsed_page", "parsed search timeline page was nil", nil)
	}

	cliResponse := &CLIResponse{
		Media:     parsed.Media,
		Metadata:  parsed.Metadata,
		Cursor:    "",
		Completed: true,
		Total:     len(parsed.Media),
	}

	accountName := cleanUsername(req.Username)
	if accountName == "" {
		accountName = strings.TrimSpace(req.Username)
	}
	accountInfo := AccountInfo{
		Name: accountName,
		Nick: accountName,
	}
	if userFound {
		applyAccountInfoFromUser(&accountInfo, parseXUserInfo(user), true)
	}

	timeline := buildSearchTimelineEntriesFromCLIResponse(cliResponse, strings.EqualFold(strings.TrimSpace(req.MediaFilter), "text"))
	return buildTwitterResponse(accountInfo, timeline, 0, 0, "", true), nil
}

func xCountTimelineEntryType(entries []TimelineEntry, entryType string) int {
	count := 0
	for _, entry := range entries {
		if strings.EqualFold(strings.TrimSpace(entry.Type), entryType) {
			count++
		}
	}
	return count
}

func appendXPublicSearchDiagnosticLog(entry xPublicSearchDiagnosticLogEntry) {
	recordXPublicSearchDiagnosticLogEntry(entry)
	data, err := json.Marshal(entry)
	if err != nil {
		return
	}
	_ = AppendBackendDiagnosticLog("info", string(data))
}
