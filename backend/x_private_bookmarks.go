package backend

import (
	"context"
	"encoding/json"
	"net/http"
	"net/url"
	"strings"
	"time"
)

const xBookmarksPath = "/graphql/pLtjrO4ubNh996M_Cubwsg/Bookmarks"

type xBookmarksEnvelope struct {
	Data struct {
		BookmarkTimelineV2 struct {
			Timeline struct {
				Instructions []xTimelineInstruction `json:"instructions"`
			} `json:"timeline"`
		} `json:"bookmark_timeline_v2"`
	} `json:"data"`
	Errors []xAPIError `json:"errors"`
}

type xPrivateBookmarksDiagnosticLogEntry struct {
	Event          string `json:"event"`
	MediaType      string `json:"media_type,omitempty"`
	AuthMode       string `json:"auth_mode,omitempty"`
	Stage          string `json:"stage,omitempty"`
	FallbackCode   string `json:"fallback_code,omitempty"`
	CursorPresent  bool   `json:"cursor_present"`
	PageItemCount  int    `json:"page_item_count,omitempty"`
	MediaItemCount int    `json:"media_item_count,omitempty"`
	TextItemCount  int    `json:"text_item_count,omitempty"`
	PartialParse   bool   `json:"partial_parse"`
	Success        bool   `json:"success"`
	ElapsedMS      int64  `json:"elapsed_ms"`
	Error          string `json:"error,omitempty"`
}

func (c *xAPIClient) extractPrivateBookmarksTimeline(ctx context.Context, req TimelineRequest) (response *TwitterResponse, err error) {
	startedAt := time.Now()
	logEntry := xPrivateBookmarksDiagnosticLogEntry{
		Event:     "x_private_bookmarks_request",
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
		appendXPrivateBookmarksDiagnosticLog(logEntry)
	}()

	session, err := c.newAuthenticatedSession(strings.TrimSpace(req.AuthToken))
	if err != nil {
		return nil, err
	}

	filter := xNormalizeRequestedMediaType(req.MediaType)
	textOnly := strings.EqualFold(strings.TrimSpace(req.MediaType), "text")
	if textOnly {
		filter = "all"
	}

	logEntry.Stage = "fetch"
	page, err := session.fetchBookmarksPage(ctx, xResolveTimelinePageCount(req.BatchSize), strings.TrimSpace(req.Cursor))
	if err != nil {
		return nil, err
	}

	logEntry.Stage = "parse"
	parsed, err := parseXTimelinePage(page.Data.BookmarkTimelineV2.Timeline.Instructions, xTimelineParseOptions{
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
	response, err = buildPrivateBookmarksTimelineResponseFromParsed(req, parsed)
	if err != nil {
		return nil, err
	}
	logEntry.TextItemCount = xCountTimelineEntryType(response.Timeline, "text")
	return response, nil
}

func (s *xAPISession) fetchBookmarksPage(ctx context.Context, count int, cursor string) (*xBookmarksEnvelope, error) {
	params := url.Values{}
	variables := map[string]any{
		"count":                  count,
		"includePromotedContent": false,
	}
	if strings.TrimSpace(cursor) != "" {
		variables["cursor"] = cursor
	}

	params.Set("variables", xMustJSONString(variables))
	params.Set("features", xMustJSONString(xTimelinePaginationFeatures()))

	var envelope xBookmarksEnvelope
	if err := s.doJSON(ctx, "fetch", http.MethodGet, xAPIRootURL, xBookmarksPath, params, true, &envelope); err != nil {
		return nil, err
	}
	if len(envelope.Errors) > 0 {
		return nil, xWrapFallback("fetch", "api_errors", "x api returned bookmarks timeline errors", xErrorsAsError(envelope.Errors))
	}
	if len(envelope.Data.BookmarkTimelineV2.Timeline.Instructions) == 0 {
		return nil, xWrapFallback("fetch", "missing_instructions", "x api bookmarks timeline returned no instructions", nil)
	}
	return &envelope, nil
}

func buildPrivateBookmarksTimelineResponseFromParsed(
	req TimelineRequest,
	parsed *xParsedTimelinePage,
) (*TwitterResponse, error) {
	if parsed == nil {
		return nil, xWrapFallback("normalize", "nil_parsed_page", "parsed bookmarks timeline page was nil", nil)
	}

	cursor := strings.TrimSpace(parsed.Cursor)
	pageSize := xResolveTimelinePageCount(req.BatchSize)
	if parsed.RawTweetCount > 0 && cursor == "" && parsed.RawTweetCount >= pageSize {
		return nil, xWrapFallback("normalize", "missing_cursor", "bookmarks timeline returned a full page without a continuation cursor", nil)
	}

	cliResponse := &CLIResponse{
		Media:     parsed.Media,
		Metadata:  parsed.Metadata,
		Cursor:    cursor,
		Completed: cursor == "",
		Total:     len(parsed.Media),
	}

	accountInfo := AccountInfo{
		Name: "bookmarks",
		Nick: "My Bookmarks",
	}

	timeline := buildTimelineEntriesFromCLIResponse(cliResponse, strings.EqualFold(strings.TrimSpace(req.MediaType), "text"))
	return buildTwitterResponse(accountInfo, timeline, req.Page, req.BatchSize, cursor, cursor == ""), nil
}

func appendXPrivateBookmarksDiagnosticLog(entry xPrivateBookmarksDiagnosticLogEntry) {
	recordXPrivateBookmarksDiagnosticLogEntry(entry)
	data, err := json.Marshal(entry)
	if err != nil {
		return
	}
	_ = AppendBackendDiagnosticLog("info", string(data))
}
