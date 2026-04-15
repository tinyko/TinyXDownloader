package backend

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

const (
	xTimelineStageInitial     = 1
	xTimelineStageSearchLinks = 2
	xTimelineStageSearchAll   = 3
	xSearchTimelineStopTweets = 3
	xSearchTimelineProduct    = "Latest"
	xTimelinePageMinimumCount = 50
)

type xSearchTimelineEnvelope struct {
	Data struct {
		SearchByRawQuery struct {
			SearchTimeline struct {
				Timeline struct {
					Instructions []xTimelineInstruction `json:"instructions"`
				} `json:"timeline"`
			} `json:"search_timeline"`
		} `json:"search_by_raw_query"`
	} `json:"data"`
	Errors []xAPIError `json:"errors"`
}

type xParsedTimelinePage struct {
	Media         []CLIMediaItem
	Metadata      []TweetMetadata
	Cursor        string
	RawTweetCount int
	LastTweetID   string
}

type xTimelineParseOptions struct {
	Filter          string
	IncludeRetweets bool
	TextOnly        bool
}

type xPreparedTimelineTweet struct {
	Tweet     xTweetResult
	Author    UserInfo
	User      UserInfo
	RetweetID TweetIDString
}

type xTimelineStageCursor struct {
	Stage     int
	TweetID   string
	RawCursor string
}

type xPublicTimelineDiagnosticLogEntry struct {
	Event          string `json:"event"`
	Username       string `json:"username,omitempty"`
	TimelineType   string `json:"timeline_type,omitempty"`
	MediaType      string `json:"media_type,omitempty"`
	AuthMode       string `json:"auth_mode,omitempty"`
	Stage          string `json:"stage,omitempty"`
	CursorStage    int    `json:"cursor_stage,omitempty"`
	FallbackCode   string `json:"fallback_code,omitempty"`
	CursorPresent  bool   `json:"cursor_present"`
	PageItemCount  int    `json:"page_item_count,omitempty"`
	MediaItemCount int    `json:"media_item_count,omitempty"`
	MetadataCount  int    `json:"metadata_count,omitempty"`
	PartialParse   bool   `json:"partial_parse"`
	Success        bool   `json:"success"`
	ElapsedMS      int64  `json:"elapsed_ms"`
	Error          string `json:"error,omitempty"`
}

func (c *xAPIClient) extractPublicTimeline(ctx context.Context, req TimelineRequest) (response *TwitterResponse, err error) {
	startedAt := time.Now()
	spec := buildTimelineExtractorSpec(req)
	logEntry := xPublicTimelineDiagnosticLogEntry{
		Event:        "x_public_timeline_request",
		Username:     cleanUsername(req.Username),
		TimelineType: strings.TrimSpace(spec.timelineType),
		MediaType:    strings.TrimSpace(req.MediaType),
		AuthMode:     xAuthMode(req.AuthToken),
		Stage:        "lookup",
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
		appendXPublicTimelineDiagnosticLog(logEntry)
	}()

	session, err := c.newSession(strings.TrimSpace(req.AuthToken))
	if err != nil {
		return nil, err
	}

	user, err := session.resolveUserByScreenName(ctx, cleanUsername(req.Username))
	if err != nil {
		return nil, err
	}

	filter := xNormalizeRequestedMediaType(req.MediaType)
	textOnly := strings.EqualFold(strings.TrimSpace(req.MediaType), "text")
	if textOnly {
		filter = "all"
	}

	options := xTimelineParseOptions{
		Filter:          filter,
		IncludeRetweets: req.Retweets,
		TextOnly:        textOnly,
	}

	switch strings.ToLower(strings.TrimSpace(spec.timelineType)) {
	case "tweets":
		logEntry.Stage = "fetch"
		page, fetchErr := session.fetchUserTweetsPage(ctx, user.RestID, xResolveTimelinePageCount(req.BatchSize), strings.TrimSpace(req.Cursor), false)
		if fetchErr != nil {
			err = fetchErr
			return nil, err
		}
		logEntry.Stage = "parse"
		parsed, parseErr := parseXTimelinePage(page.Data.User.Result.Timeline.Timeline.Instructions, options)
		if parseErr != nil {
			err = parseErr
			return nil, err
		}
		logEntry.PageItemCount = parsed.RawTweetCount
		logEntry.MediaItemCount = len(parsed.Media)
		logEntry.MetadataCount = len(parsed.Metadata)
		logEntry.CursorPresent = strings.TrimSpace(parsed.Cursor) != ""
		logEntry.Stage = "normalize"
		response, err = buildDirectTimelineResponse(req, user, spec, parsed)
		return response, err
	case "with_replies":
		logEntry.Stage = "fetch"
		page, fetchErr := session.fetchUserTweetsPage(ctx, user.RestID, xResolveTimelinePageCount(req.BatchSize), strings.TrimSpace(req.Cursor), true)
		if fetchErr != nil {
			err = fetchErr
			return nil, err
		}
		logEntry.Stage = "parse"
		parsed, parseErr := parseXTimelinePage(page.Data.User.Result.Timeline.Timeline.Instructions, options)
		if parseErr != nil {
			err = parseErr
			return nil, err
		}
		logEntry.PageItemCount = parsed.RawTweetCount
		logEntry.MediaItemCount = len(parsed.Media)
		logEntry.MetadataCount = len(parsed.Metadata)
		logEntry.CursorPresent = strings.TrimSpace(parsed.Cursor) != ""
		logEntry.Stage = "normalize"
		response, err = buildDirectTimelineResponse(req, user, spec, parsed)
		return response, err
	default:
		response, err = c.extractStagedTimeline(ctx, req, spec, user, session, options, &logEntry)
		return response, err
	}
}

func (c *xAPIClient) extractStagedTimeline(
	ctx context.Context,
	req TimelineRequest,
	spec extractorRequestSpec,
	user xUserResult,
	session *xAPISession,
	options xTimelineParseOptions,
	logEntry *xPublicTimelineDiagnosticLogEntry,
) (*TwitterResponse, error) {
	resume, err := xParseTimelineStageCursor(strings.TrimSpace(req.Cursor))
	if err != nil {
		return nil, err
	}
	if resume.Stage == 0 {
		resume.Stage = xTimelineStageInitial
	}
	if options.TextOnly && resume.Stage == xTimelineStageSearchLinks {
		resume.Stage = xTimelineStageSearchAll
	}

	combined := &xParsedTimelinePage{
		Media:    make([]CLIMediaItem, 0, 32),
		Metadata: make([]TweetMetadata, 0, 32),
	}

	if resume.Stage <= xTimelineStageInitial {
		logEntry.Stage = "fetch"
		page, fetchErr := xFetchTimelineStageOne(ctx, session, user.RestID, spec, xResolveTimelinePageCount(req.BatchSize), resume.RawCursor)
		if fetchErr != nil {
			return nil, fetchErr
		}
		logEntry.Stage = "parse"
		parsed, parseErr := parseXTimelinePage(page.Data.User.Result.Timeline.Timeline.Instructions, options)
		if parseErr != nil {
			return nil, parseErr
		}
		xMergeParsedTimelinePage(combined, parsed)
		if parsed.RawTweetCount == 0 && strings.TrimSpace(parsed.Cursor) == "" && strings.TrimSpace(req.Cursor) == "" {
			logEntry.PageItemCount = combined.RawTweetCount
			logEntry.MediaItemCount = len(combined.Media)
			logEntry.MetadataCount = len(combined.Metadata)
			logEntry.CursorPresent = false
			logEntry.CursorStage = xTimelineStageInitial
			logEntry.Stage = "normalize"
			return buildTimelineTwitterResponse(req, spec, user, combined, "", true), nil
		}
		if strings.TrimSpace(parsed.Cursor) != "" {
			compositeCursor := xBuildTimelineStageCursor(xTimelineStageInitial, "", parsed.Cursor)
			logEntry.PageItemCount = combined.RawTweetCount
			logEntry.MediaItemCount = len(combined.Media)
			logEntry.MetadataCount = len(combined.Metadata)
			logEntry.CursorPresent = true
			logEntry.CursorStage = xTimelineStageInitial
			logEntry.Stage = "normalize"
			return buildTimelineTwitterResponse(req, spec, user, combined, compositeCursor, false), nil
		}
		if strings.TrimSpace(parsed.LastTweetID) == "" {
			return nil, xWrapFallback("normalize", "missing_stage_transition_tweet", "timeline stage 1 completed without a transition tweet id", nil)
		}
		resume.Stage = xTimelineStageSearchLinks
		if options.TextOnly {
			resume.Stage = xTimelineStageSearchAll
		}
		resume.TweetID = parsed.LastTweetID
		resume.RawCursor = ""
	}

	if resume.Stage <= xTimelineStageSearchLinks && !options.TextOnly {
		logEntry.Stage = "fetch"
		stageTwo, fetchErr := session.fetchSearchTimelineStage(
			ctx,
			xBuildTimelineSearchQuery(user, resume.TweetID, true, req.Retweets),
			xResolveTimelinePageCount(req.BatchSize),
			resume,
			options,
		)
		if fetchErr != nil {
			return nil, fetchErr
		}
		logEntry.Stage = "parse"
		xMergeParsedTimelinePage(combined, stageTwo.Page)
		if stageTwo.Page.RawTweetCount > 0 {
			logEntry.PageItemCount = combined.RawTweetCount
			logEntry.MediaItemCount = len(combined.Media)
			logEntry.MetadataCount = len(combined.Metadata)
			logEntry.CursorPresent = strings.TrimSpace(stageTwo.ResumeCursor) != ""
			logEntry.CursorStage = xTimelineStageSearchLinks
			logEntry.Stage = "normalize"
			return buildTimelineTwitterResponse(req, spec, user, combined, stageTwo.ResumeCursor, strings.TrimSpace(stageTwo.ResumeCursor) == ""), nil
		}
		resume.Stage = xTimelineStageSearchAll
		resume.TweetID = stageTwo.ResumeTweetID
		resume.RawCursor = ""
	}

	logEntry.Stage = "fetch"
	stageThree, fetchErr := session.fetchSearchTimelineStage(
		ctx,
		xBuildTimelineSearchQuery(user, resume.TweetID, false, req.Retweets),
		xResolveTimelinePageCount(req.BatchSize),
		resume,
		options,
	)
	if fetchErr != nil {
		return nil, fetchErr
	}
	logEntry.Stage = "parse"
	xMergeParsedTimelinePage(combined, stageThree.Page)
	logEntry.PageItemCount = combined.RawTweetCount
	logEntry.MediaItemCount = len(combined.Media)
	logEntry.MetadataCount = len(combined.Metadata)
	logEntry.CursorPresent = strings.TrimSpace(stageThree.ResumeCursor) != ""
	logEntry.CursorStage = xTimelineStageSearchAll
	logEntry.Stage = "normalize"
	return buildTimelineTwitterResponse(req, spec, user, combined, stageThree.ResumeCursor, strings.TrimSpace(stageThree.ResumeCursor) == ""), nil
}

func xFetchTimelineStageOne(
	ctx context.Context,
	session *xAPISession,
	userID string,
	spec extractorRequestSpec,
	count int,
	cursor string,
) (*xUserMediaEnvelope, error) {
	if xTimelineStageOneUsesUserTweets(spec) {
		return session.fetchUserTweetsPage(ctx, userID, count, cursor, false)
	}
	return session.fetchUserMediaPage(ctx, userID, count, cursor)
}

func xTimelineStageOneUsesUserTweets(spec extractorRequestSpec) bool {
	return spec.textOnly || spec.payload.Retweets == "include"
}

func (s *xAPISession) fetchUserTweetsPage(ctx context.Context, userID string, count int, cursor string, withReplies bool) (*xUserMediaEnvelope, error) {
	params := url.Values{}
	variables := map[string]any{
		"userId":                 userID,
		"count":                  count,
		"includePromotedContent": false,
		"withVoice":              true,
	}
	endpoint := xUserTweetsPath
	if withReplies {
		endpoint = xUserTweetsRepliesPath
		variables["withCommunity"] = true
	} else {
		variables["withQuickPromoteEligibilityTweetFields"] = false
	}
	if strings.TrimSpace(cursor) != "" {
		variables["cursor"] = cursor
	}

	params.Set("variables", xMustJSONString(variables))
	params.Set("features", xMustJSONString(xTimelinePaginationFeatures()))
	params.Set("fieldToggles", xMustJSONString(xTimelineFieldToggles()))

	var envelope xUserMediaEnvelope
	if err := s.doJSON(ctx, "fetch", http.MethodGet, xAPIRootURL, endpoint, params, true, &envelope); err != nil {
		return nil, err
	}
	if len(envelope.Errors) > 0 {
		return nil, xWrapFallback("fetch", "api_errors", "x api returned timeline errors", xErrorsAsError(envelope.Errors))
	}
	if len(envelope.Data.User.Result.Timeline.Timeline.Instructions) == 0 {
		return nil, xWrapFallback("fetch", "missing_instructions", "x api timeline returned no instructions", nil)
	}
	return &envelope, nil
}

type xSearchStageResult struct {
	Page          *xParsedTimelinePage
	ResumeCursor  string
	ResumeTweetID string
}

func (s *xAPISession) fetchSearchTimelineStage(
	ctx context.Context,
	query string,
	count int,
	resume xTimelineStageCursor,
	options xTimelineParseOptions,
) (*xSearchStageResult, error) {
	currentCursor := strings.TrimSpace(resume.RawCursor)
	baseTweetID := strings.TrimSpace(resume.TweetID)
	if baseTweetID == "" {
		return nil, xWrapFallback("normalize", "missing_search_tweet_id", "timeline search stage is missing its base tweet id", nil)
	}

	stopTweets := xSearchTimelineStopTweets
	for {
		envelope, err := s.fetchSearchTimelinePage(ctx, query, count, currentCursor)
		if err != nil {
			return nil, err
		}
		page, err := parseXTimelinePage(envelope.Data.SearchByRawQuery.SearchTimeline.Timeline.Instructions, options)
		if err != nil {
			return nil, err
		}

		if page.RawTweetCount > 0 {
			if strings.TrimSpace(page.LastTweetID) != "" {
				return &xSearchStageResult{
					Page:          page,
					ResumeCursor:  xBuildTimelineStageCursor(resume.Stage, page.LastTweetID, ""),
					ResumeTweetID: page.LastTweetID,
				}, nil
			}
			if strings.TrimSpace(page.Cursor) != "" {
				return &xSearchStageResult{
					Page:          page,
					ResumeCursor:  xBuildTimelineStageCursor(resume.Stage, baseTweetID, page.Cursor),
					ResumeTweetID: baseTweetID,
				}, nil
			}
			return &xSearchStageResult{
				Page:          page,
				ResumeCursor:  "",
				ResumeTweetID: baseTweetID,
			}, nil
		}

		nextCursor := strings.TrimSpace(page.Cursor)
		if nextCursor == "" || nextCursor == currentCursor || stopTweets <= 1 {
			return &xSearchStageResult{
				Page:          page,
				ResumeCursor:  "",
				ResumeTweetID: baseTweetID,
			}, nil
		}

		stopTweets--
		currentCursor = nextCursor
	}
}

func (s *xAPISession) fetchSearchTimelinePage(ctx context.Context, query string, count int, cursor string) (*xSearchTimelineEnvelope, error) {
	params := url.Values{}
	variables := map[string]any{
		"rawQuery":              query,
		"count":                 count,
		"querySource":           "typed_query",
		"product":               xSearchTimelineProduct,
		"withGrokTranslatedBio": false,
	}
	if strings.TrimSpace(cursor) != "" {
		variables["cursor"] = cursor
	}
	params.Set("variables", xMustJSONString(variables))
	params.Set("features", xMustJSONString(xTimelinePaginationFeatures()))
	params.Set("fieldToggles", xMustJSONString(xTimelineFieldToggles()))

	var envelope xSearchTimelineEnvelope
	if err := s.doJSON(ctx, "fetch", http.MethodGet, xAPIRootURL, xSearchTimelinePath, params, true, &envelope); err != nil {
		return nil, err
	}
	if len(envelope.Errors) > 0 {
		return nil, xWrapFallback("fetch", "api_errors", "x api returned search timeline errors", xErrorsAsError(envelope.Errors))
	}
	if len(envelope.Data.SearchByRawQuery.SearchTimeline.Timeline.Instructions) == 0 {
		return nil, xWrapFallback("fetch", "missing_instructions", "x api search timeline returned no instructions", nil)
	}
	return &envelope, nil
}

func parseXTimelinePage(instructions []xTimelineInstruction, options xTimelineParseOptions) (*xParsedTimelinePage, error) {
	if len(instructions) == 0 {
		return nil, xWrapFallback("parse", "missing_instructions", "timeline response contained no instructions", nil)
	}

	filter := options.Filter
	if strings.TrimSpace(filter) == "" {
		filter = "all"
	}

	page := &xParsedTimelinePage{
		Media:    make([]CLIMediaItem, 0, 16),
		Metadata: make([]TweetMetadata, 0, 16),
	}
	seenMedia := make(map[string]struct{})
	seenMeta := make(map[TweetIDString]struct{})

	appendContent := func(content xTimelineItemContent) error {
		if len(content.PromotedMetadata) > 0 && string(content.PromotedMetadata) != "null" {
			return nil
		}

		prepared, skip, err := xPrepareTimelineTweet(content.TweetResults.Result, options.IncludeRetweets)
		if err != nil {
			if page.RawTweetCount > 0 || len(page.Media) > 0 || len(page.Metadata) > 0 {
				err = xMarkPartialParse(err)
			}
			return err
		}
		if skip || prepared == nil {
			return nil
		}

		page.RawTweetCount++
		page.LastTweetID = strings.TrimSpace(prepared.Tweet.RestID)

		metadata, err := buildTweetMetadataFromPreparedTweet(*prepared)
		if err != nil {
			if page.RawTweetCount > 1 || len(page.Media) > 0 || len(page.Metadata) > 0 {
				err = xMarkPartialParse(err)
			}
			return err
		}
		if _, exists := seenMeta[metadata.TweetID]; !exists {
			seenMeta[metadata.TweetID] = struct{}{}
			page.Metadata = append(page.Metadata, metadata)
		}

		mediaItems, err := buildCLIMediaItemsFromPreparedTweet(*prepared)
		if err != nil {
			if page.RawTweetCount > 1 || len(page.Media) > 0 || len(page.Metadata) > 0 {
				err = xMarkPartialParse(err)
			}
			return err
		}
		for _, mediaItem := range mediaItems {
			if !xMatchesRequestedMediaType(mediaItem.Type, filter) {
				continue
			}
			key := fmt.Sprintf("%d|%s|%s", mediaItem.TweetID, mediaItem.URL, mediaItem.Type)
			if _, exists := seenMedia[key]; exists {
				continue
			}
			seenMedia[key] = struct{}{}
			page.Media = append(page.Media, mediaItem)
		}
		return nil
	}

	appendEntry := func(entry xTimelineEntry) error {
		entryID := strings.TrimSpace(entry.EntryID)
		switch {
		case strings.HasPrefix(entryID, "cursor-bottom-"):
			page.Cursor = strings.TrimSpace(entry.Content.Value)
			return nil
		case len(entry.Content.Items) > 0:
			for _, moduleItem := range entry.Content.Items {
				if err := appendContent(moduleItem.Item.ItemContent); err != nil {
					return err
				}
			}
			return nil
		case entry.Content.ItemContent.ItemType != "" ||
			strings.TrimSpace(entry.Content.ItemContent.TypeName) != "" ||
			len(entry.Content.ItemContent.PromotedMetadata) > 0 ||
			strings.TrimSpace(entry.Content.ItemContent.TweetResults.Result.RestID) != "" ||
			entry.Content.ItemContent.TweetResults.Result.Tweet != nil:
			return appendContent(entry.Content.ItemContent)
		default:
			return nil
		}
	}

	for _, instruction := range instructions {
		switch instruction.Type {
		case "TimelineAddEntries":
			for _, entry := range instruction.Entries {
				if err := appendEntry(entry); err != nil {
					return nil, err
				}
			}
		case "TimelineAddToModule":
			for _, moduleItem := range instruction.ModuleItems {
				if err := appendContent(moduleItem.Item.ItemContent); err != nil {
					return nil, err
				}
			}
		case "TimelineReplaceEntry":
			if strings.HasPrefix(strings.TrimSpace(instruction.Entry.EntryID), "cursor-bottom-") {
				page.Cursor = strings.TrimSpace(instruction.Entry.Content.Value)
			}
		case "TimelinePinEntry":
			if err := appendEntry(instruction.Entry); err != nil {
				return nil, err
			}
		}
	}

	return page, nil
}

func xPrepareTimelineTweet(result xTweetResult, includeRetweets bool) (*xPreparedTimelineTweet, bool, error) {
	tweet, err := unwrapXTweetResult(result)
	if err != nil {
		return nil, false, err
	}
	if strings.TrimSpace(tweet.RestID) == "" {
		return nil, true, nil
	}

	authorResult := tweet.Core.UserResults.Result
	retweetID := TweetIDString(0)
	if tweet.Legacy.RetweetedStatusResult != nil {
		if !includeRetweets {
			return nil, true, nil
		}
		retweet, unwrapErr := unwrapXTweetResult(tweet.Legacy.RetweetedStatusResult.Result)
		if unwrapErr != nil {
			return nil, false, unwrapErr
		}
		if parsedRetweetID, parseErr := xParseTweetID(retweet.RestID); parseErr == nil {
			retweetID = parsedRetweetID
		}
		authorResult = retweet.Core.UserResults.Result
		if retweet.NoteTweet != nil {
			tweet.NoteTweet = retweet.NoteTweet
		}
		if len(retweet.Legacy.ExtendedEntities.Media) > 0 && len(tweet.Legacy.ExtendedEntities.Media) == 0 {
			tweet.Legacy.ExtendedEntities = retweet.Legacy.ExtendedEntities
		}
		if strings.TrimSpace(retweet.Legacy.FullText) != "" {
			tweet.Legacy.FullText = retweet.Legacy.FullText
		}
		tweet.Core.UserResults.Result = authorResult
	}

	author := parseXUserInfo(authorResult)
	return &xPreparedTimelineTweet{
		Tweet:     tweet,
		Author:    author,
		User:      author,
		RetweetID: retweetID,
	}, false, nil
}

func buildCLIMediaItemsFromPreparedTweet(prepared xPreparedTimelineTweet) ([]CLIMediaItem, error) {
	tweet := prepared.Tweet
	if strings.TrimSpace(tweet.RestID) == "" {
		return nil, xWrapFallback("parse", "missing_tweet_id", "tweet result did not include a tweet id", nil)
	}
	tweetID, err := xParseTweetID(tweet.RestID)
	if err != nil {
		return nil, xWrapFallback("parse", "invalid_tweet_id", "tweet id could not be parsed", err)
	}
	date, err := xParseTweetDate(tweet.Legacy.CreatedAt)
	if err != nil {
		return nil, xWrapFallback("parse", "invalid_tweet_date", "tweet date could not be parsed", err)
	}
	entities := tweet.Legacy.ExtendedEntities.Media
	if len(entities) == 0 {
		return nil, nil
	}

	content := strings.TrimSpace(tweet.Legacy.FullText)
	if content == "" && tweet.NoteTweet != nil {
		content = strings.TrimSpace(tweet.NoteTweet.NoteTweetResults.Result.Text)
	}

	conversationID, _ := xParseOptionalTweetID(tweet.Legacy.ConversationIDStr)
	items := make([]CLIMediaItem, 0, len(entities))
	for _, entity := range entities {
		item, ok, err := buildCLIMediaItemFromEntity(tweetID, date, content, prepared.Author, prepared.User, tweet, entity, conversationID)
		if err != nil {
			return nil, err
		}
		if ok {
			item.RetweetID = prepared.RetweetID
			items = append(items, item)
		}
	}
	return items, nil
}

func buildTweetMetadataFromPreparedTweet(prepared xPreparedTimelineTweet) (TweetMetadata, error) {
	tweet := prepared.Tweet
	if strings.TrimSpace(tweet.RestID) == "" {
		return TweetMetadata{}, xWrapFallback("parse", "missing_tweet_id", "tweet result did not include a tweet id", nil)
	}
	tweetID, err := xParseTweetID(tweet.RestID)
	if err != nil {
		return TweetMetadata{}, xWrapFallback("parse", "invalid_tweet_id", "tweet id could not be parsed", err)
	}
	date, err := xParseTweetDate(tweet.Legacy.CreatedAt)
	if err != nil {
		return TweetMetadata{}, xWrapFallback("parse", "invalid_tweet_date", "tweet date could not be parsed", err)
	}

	content := strings.TrimSpace(tweet.Legacy.FullText)
	if content == "" && tweet.NoteTweet != nil {
		content = strings.TrimSpace(tweet.NoteTweet.NoteTweetResults.Result.Text)
	}

	conversationID, _ := xParseOptionalTweetID(tweet.Legacy.ConversationIDStr)
	hashtags := make([]string, 0, len(tweet.Legacy.Entities.Hashtags))
	for _, hashtag := range tweet.Legacy.Entities.Hashtags {
		if text := strings.TrimSpace(hashtag.Text); text != "" {
			hashtags = append(hashtags, text)
		}
	}

	return TweetMetadata{
		TweetID:        tweetID,
		RetweetID:      prepared.RetweetID,
		ConversationID: conversationID,
		Date:           date,
		Author: Author{
			ID:   prepared.Author.ID,
			Name: prepared.Author.Name,
			Nick: prepared.Author.Nick,
		},
		Content:       content,
		Lang:          strings.TrimSpace(tweet.Legacy.Lang),
		Hashtags:      hashtags,
		FavoriteCount: tweet.Legacy.FavoriteCount,
		RetweetCount:  tweet.Legacy.RetweetCount,
		QuoteCount:    tweet.Legacy.QuoteCount,
		ReplyCount:    tweet.Legacy.ReplyCount,
		BookmarkCount: tweet.Legacy.BookmarkCount,
		Sensitive:     tweet.Legacy.PossiblySensitive,
	}, nil
}

func buildDirectTimelineResponse(req TimelineRequest, user xUserResult, spec extractorRequestSpec, parsed *xParsedTimelinePage) (*TwitterResponse, error) {
	cursor := strings.TrimSpace(parsed.Cursor)
	return buildTimelineTwitterResponse(req, spec, user, parsed, cursor, cursor == ""), nil
}

func buildTimelineTwitterResponse(
	req TimelineRequest,
	spec extractorRequestSpec,
	user xUserResult,
	parsed *xParsedTimelinePage,
	cursor string,
	completed bool,
) *TwitterResponse {
	cliResponse := &CLIResponse{
		Media:     parsed.Media,
		Metadata:  parsed.Metadata,
		Cursor:    cursor,
		Completed: completed,
		Total:     len(parsed.Media),
	}

	timeline := buildTimelineEntriesFromCLIResponse(cliResponse, spec.textOnly)
	accountInfo := AccountInfo{}
	applyAccountInfoFromUser(&accountInfo, parseXUserInfo(user), true)
	return buildTwitterResponse(accountInfo, timeline, req.Page, req.BatchSize, cursor, completed)
}

func xMergeParsedTimelinePage(target *xParsedTimelinePage, source *xParsedTimelinePage) {
	if target == nil || source == nil {
		return
	}

	seenMedia := make(map[string]struct{}, len(target.Media))
	for _, item := range target.Media {
		key := fmt.Sprintf("%d|%s|%s", item.TweetID, item.URL, item.Type)
		seenMedia[key] = struct{}{}
	}
	for _, item := range source.Media {
		key := fmt.Sprintf("%d|%s|%s", item.TweetID, item.URL, item.Type)
		if _, exists := seenMedia[key]; exists {
			continue
		}
		seenMedia[key] = struct{}{}
		target.Media = append(target.Media, item)
	}

	seenMetadata := make(map[TweetIDString]struct{}, len(target.Metadata))
	for _, item := range target.Metadata {
		seenMetadata[item.TweetID] = struct{}{}
	}
	for _, item := range source.Metadata {
		if _, exists := seenMetadata[item.TweetID]; exists {
			continue
		}
		seenMetadata[item.TweetID] = struct{}{}
		target.Metadata = append(target.Metadata, item)
	}

	target.RawTweetCount += source.RawTweetCount
	if strings.TrimSpace(source.LastTweetID) != "" {
		target.LastTweetID = source.LastTweetID
	}
	if strings.TrimSpace(source.Cursor) != "" {
		target.Cursor = source.Cursor
	}
}

func xBuildTimelineSearchQuery(user xUserResult, tweetID string, mediaOnly bool, includeRetweets bool) string {
	query := fmt.Sprintf("from:%s max_id:%s", strings.TrimSpace(user.Core.ScreenName), strings.TrimSpace(tweetID))
	if includeRetweets {
		query += " include:retweets include:nativeretweets"
	}
	if mediaOnly {
		query += " filter:links"
	}
	return query
}

func xParseTimelineStageCursor(raw string) (xTimelineStageCursor, error) {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return xTimelineStageCursor{}, nil
	}
	prefix := trimmed
	rawCursor := ""
	if slash := strings.Index(trimmed, "/"); slash >= 0 {
		prefix = trimmed[:slash]
		rawCursor = trimmed[slash+1:]
	} else {
		return xTimelineStageCursor{
			Stage:     xTimelineStageInitial,
			RawCursor: trimmed,
		}, nil
	}

	stagePart := prefix
	tweetID := ""
	if underscore := strings.Index(prefix, "_"); underscore >= 0 {
		stagePart = prefix[:underscore]
		tweetID = prefix[underscore+1:]
	}
	stage, err := strconv.Atoi(strings.TrimSpace(stagePart))
	if err != nil {
		return xTimelineStageCursor{}, xWrapFallback("normalize", "invalid_timeline_cursor", "timeline cursor prefix could not be parsed", err)
	}
	if stage < xTimelineStageInitial || stage > xTimelineStageSearchAll {
		return xTimelineStageCursor{}, xWrapFallback("normalize", "invalid_timeline_cursor", "timeline cursor stage is unsupported", nil)
	}
	if stage >= xTimelineStageSearchLinks && strings.TrimSpace(tweetID) == "" {
		return xTimelineStageCursor{}, xWrapFallback("normalize", "invalid_timeline_cursor", "timeline search cursor is missing a tweet id", nil)
	}
	return xTimelineStageCursor{
		Stage:     stage,
		TweetID:   strings.TrimSpace(tweetID),
		RawCursor: strings.TrimSpace(rawCursor),
	}, nil
}

func xBuildTimelineStageCursor(stage int, tweetID string, rawCursor string) string {
	prefix := strconv.Itoa(stage)
	if stage >= xTimelineStageSearchLinks && strings.TrimSpace(tweetID) != "" {
		prefix += "_" + strings.TrimSpace(tweetID)
	}
	if strings.TrimSpace(rawCursor) != "" {
		return prefix + "/" + strings.TrimSpace(rawCursor)
	}
	return prefix + "/"
}

func xResolveTimelinePageCount(batchSize int) int {
	if batchSize > xTimelinePageMinimumCount {
		return batchSize
	}
	return xTimelinePageMinimumCount
}

func xTimelinePaginationFeatures() map[string]any {
	return map[string]any{
		"rweb_video_screen_enabled": false,
		"payments_enabled":          false,
		"rweb_xchat_enabled":        false,
		"profile_label_improvements_pcf_label_in_post_enabled":                    true,
		"rweb_tipjar_consumption_enabled":                                         true,
		"verified_phone_label_enabled":                                            false,
		"creator_subscriptions_tweet_preview_api_enabled":                         true,
		"responsive_web_graphql_timeline_navigation_enabled":                      true,
		"responsive_web_graphql_skip_user_profile_image_extensions_enabled":       false,
		"premium_content_api_read_enabled":                                        false,
		"communities_web_enable_tweet_community_results_fetch":                    true,
		"c9s_tweet_anatomy_moderator_badge_enabled":                               true,
		"responsive_web_grok_analyze_button_fetch_trends_enabled":                 false,
		"responsive_web_grok_analyze_post_followups_enabled":                      true,
		"responsive_web_jetfuel_frame":                                            true,
		"responsive_web_grok_share_attachment_enabled":                            true,
		"articles_preview_enabled":                                                true,
		"responsive_web_edit_tweet_api_enabled":                                   true,
		"graphql_is_translatable_rweb_tweet_is_translatable_enabled":              true,
		"view_counts_everywhere_api_enabled":                                      true,
		"longform_notetweets_consumption_enabled":                                 true,
		"responsive_web_twitter_article_tweet_consumption_enabled":                true,
		"tweet_awards_web_tipping_enabled":                                        false,
		"responsive_web_grok_show_grok_translated_post":                           false,
		"responsive_web_grok_analysis_button_from_backend":                        true,
		"creator_subscriptions_quote_tweet_preview_enabled":                       false,
		"freedom_of_speech_not_reach_fetch_enabled":                               true,
		"standardized_nudges_misinfo":                                             true,
		"tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled": true,
		"longform_notetweets_rich_text_read_enabled":                              true,
		"longform_notetweets_inline_media_enabled":                                true,
		"responsive_web_grok_image_annotation_enabled":                            true,
		"responsive_web_grok_imagine_annotation_enabled":                          true,
		"responsive_web_grok_community_note_auto_translation_is_enabled":          false,
		"responsive_web_enhance_cards_enabled":                                    false,
	}
}

func xTimelineFieldToggles() map[string]any {
	return map[string]any{
		"withArticlePlainText": false,
	}
}

func appendXPublicTimelineDiagnosticLog(entry xPublicTimelineDiagnosticLogEntry) {
	recordXPublicTimelineDiagnosticLogEntry(entry)
	data, err := json.Marshal(entry)
	if err != nil {
		return
	}
	_ = AppendBackendDiagnosticLog("info", string(data))
}
