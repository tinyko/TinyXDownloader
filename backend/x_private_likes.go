package backend

import (
	"context"
	"encoding/json"
	"net/http"
	"net/url"
	"strings"
	"time"
)

type xPrivateLikesDiagnosticLogEntry struct {
	Event          string `json:"event"`
	Username       string `json:"username,omitempty"`
	MediaType      string `json:"media_type,omitempty"`
	AuthMode       string `json:"auth_mode,omitempty"`
	Stage          string `json:"stage,omitempty"`
	FallbackCode   string `json:"fallback_code,omitempty"`
	ViewerOK       bool   `json:"viewer_ok"`
	CursorPresent  bool   `json:"cursor_present"`
	PageItemCount  int    `json:"page_item_count,omitempty"`
	MediaItemCount int    `json:"media_item_count,omitempty"`
	TextItemCount  int    `json:"text_item_count,omitempty"`
	PartialParse   bool   `json:"partial_parse"`
	Success        bool   `json:"success"`
	ElapsedMS      int64  `json:"elapsed_ms"`
	Error          string `json:"error,omitempty"`
}

func (c *xAPIClient) extractPrivateLikesTimeline(ctx context.Context, req TimelineRequest) (response *TwitterResponse, err error) {
	startedAt := time.Now()
	logEntry := xPrivateLikesDiagnosticLogEntry{
		Event:     "x_private_likes_request",
		Username:  cleanUsername(req.Username),
		MediaType: strings.TrimSpace(req.MediaType),
		AuthMode:  xAuthMode(req.AuthToken),
		Stage:     "lookup",
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
		appendXPrivateLikesDiagnosticLog(logEntry)
	}()

	username, err := xResolvePrivateLikesUsername(req)
	if err != nil {
		return nil, err
	}

	session, err := c.newAuthenticatedSession(strings.TrimSpace(req.AuthToken))
	if err != nil {
		return nil, err
	}

	user, err := session.resolveUserByScreenName(ctx, username)
	if err != nil {
		return nil, err
	}
	logEntry.ViewerOK = true

	filter := xNormalizeRequestedMediaType(req.MediaType)
	textOnly := strings.EqualFold(strings.TrimSpace(req.MediaType), "text")
	if textOnly {
		filter = "all"
	}

	logEntry.Stage = "fetch"
	page, err := session.fetchLikesPage(ctx, user.RestID, xResolveTimelinePageCount(req.BatchSize), strings.TrimSpace(req.Cursor))
	if err != nil {
		return nil, err
	}

	logEntry.Stage = "parse"
	parsed, err := parseXTimelinePage(page.Data.User.Result.Timeline.Timeline.Instructions, xTimelineParseOptions{
		Filter:          filter,
		IncludeRetweets: req.Retweets,
		TextOnly:        textOnly,
	})
	if err != nil {
		return nil, err
	}
	logEntry.PageItemCount = parsed.RawTweetCount
	logEntry.MediaItemCount = len(parsed.Media)
	logEntry.CursorPresent = strings.TrimSpace(parsed.Cursor) != ""

	logEntry.Stage = "normalize"
	response, err = buildPrivateLikesTimelineResponseFromParsed(req, user, parsed)
	if err != nil {
		return nil, err
	}
	logEntry.TextItemCount = xCountTimelineEntryType(response.Timeline, "text")
	return response, nil
}

func xResolvePrivateLikesUsername(req TimelineRequest) (string, error) {
	username := cleanUsername(req.Username)
	if strings.TrimSpace(username) == "" || strings.EqualFold(strings.TrimSpace(username), "likes") {
		return "", xWrapFallback("lookup", "missing_likes_username", "private likes extraction requires the account username associated with the auth token", nil)
	}
	return username, nil
}

func (s *xAPISession) fetchLikesPage(ctx context.Context, userID string, count int, cursor string) (*xUserMediaEnvelope, error) {
	params := url.Values{}
	variables := map[string]any{
		"userId":                 userID,
		"count":                  count,
		"includePromotedContent": false,
		"withClientEventToken":   false,
		"withBirdwatchNotes":     false,
		"withVoice":              true,
	}
	if strings.TrimSpace(cursor) != "" {
		variables["cursor"] = cursor
	}

	params.Set("variables", xMustJSONString(variables))
	params.Set("features", xMustJSONString(xTimelinePaginationFeatures()))
	params.Set("fieldToggles", xMustJSONString(map[string]any{
		"withArticlePlainText": false,
	}))

	var envelope xUserMediaEnvelope
	if err := s.doJSON(ctx, "fetch", http.MethodGet, xAPIRootURL, xLikesPath, params, true, &envelope); err != nil {
		return nil, err
	}
	if len(envelope.Errors) > 0 {
		return nil, xWrapFallback("fetch", "api_errors", "x api returned likes timeline errors", xErrorsAsError(envelope.Errors))
	}
	if len(envelope.Data.User.Result.Timeline.Timeline.Instructions) == 0 {
		return nil, xWrapFallback("fetch", "missing_instructions", "x api likes timeline returned no instructions", nil)
	}
	return &envelope, nil
}

func buildPrivateLikesTimelineResponseFromParsed(
	req TimelineRequest,
	user xUserResult,
	parsed *xParsedTimelinePage,
) (*TwitterResponse, error) {
	if parsed == nil {
		return nil, xWrapFallback("normalize", "nil_parsed_page", "parsed likes timeline page was nil", nil)
	}

	cursor := strings.TrimSpace(parsed.Cursor)
	pageSize := xResolveTimelinePageCount(req.BatchSize)
	if parsed.RawTweetCount > 0 && cursor == "" && parsed.RawTweetCount >= pageSize {
		return nil, xWrapFallback("normalize", "missing_cursor", "likes timeline returned a full page without a continuation cursor", nil)
	}

	cliResponse := &CLIResponse{
		Media:     parsed.Media,
		Metadata:  parsed.Metadata,
		Cursor:    cursor,
		Completed: cursor == "",
		Total:     len(parsed.Media),
	}

	accountInfo := AccountInfo{
		Name: "likes",
		Nick: "My Likes",
	}
	if strings.TrimSpace(user.RestID) != "" {
		applyAccountInfoFromUser(&accountInfo, parseXUserInfo(user), false)
	}

	timeline := buildTimelineEntriesFromCLIResponse(cliResponse, strings.EqualFold(strings.TrimSpace(req.MediaType), "text"))
	return buildTwitterResponse(accountInfo, timeline, req.Page, req.BatchSize, cursor, cursor == ""), nil
}

func appendXPrivateLikesDiagnosticLog(entry xPrivateLikesDiagnosticLogEntry) {
	recordXPrivateLikesDiagnosticLogEntry(entry)
	data, err := json.Marshal(entry)
	if err != nil {
		return
	}
	_ = AppendBackendDiagnosticLog("info", string(data))
}
