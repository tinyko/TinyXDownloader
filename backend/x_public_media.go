package backend

import (
	"context"
	cryptorand "crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"html"
	"io"
	mathrand "math/rand"
	"net/http"
	"net/http/cookiejar"
	"net/url"
	"path"
	"strconv"
	"strings"
	"sync"
	"time"
)

const (
	xAPIRootURL             = "https://x.com/i/api"
	xGuestAPIRootURL        = "https://api.x.com"
	xRootURL                = "https://x.com/"
	xAuthBearerToken        = "Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA"
	xDefaultTimelineCount   = 50
	xClientRequestTimeout   = 30 * time.Second
	xRateLimitCooldown      = 60 * time.Second
	xRateLimitSafetyMargin  = time.Second
	xRateLimitRetryCount    = 4
	xFirefoxLinuxUserAgent  = "Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0"
	xUserByScreenNamePath   = "/graphql/ck5KkZ8t5cOmoLssopN99Q/UserByScreenName"
	xUserMediaPath          = "/graphql/jCRhbOzdgOHp6u9H4g2tEg/UserMedia"
	xUserTweetsPath         = "/graphql/E8Wq-_jFSaU7hxVcuOPR9g/UserTweets"
	xUserTweetsRepliesPath  = "/graphql/-O3QOHrVn1aOm_cF5wyTCQ/UserTweetsAndReplies"
	xLikesPath              = "/graphql/TGEKkJG_meudeaFcqaxM-Q/Likes"
	xSearchTimelinePath     = "/graphql/4fpceYZ6-YQCx_JSl_Cn_A/SearchTimeline"
	xGuestActivatePath      = "/1.1/guest/activate.json"
	xMediaTimelineModuleKey = "profile-grid-"
)

var (
	defaultXAPIClientOnce sync.Once
	defaultXAPIClientInst *xAPIClient
	defaultXAPIClientErr  error
)

type xAPIClient struct {
	transport *http.Transport
	timeout   time.Duration

	pacingMu       sync.Mutex
	cooldownUntil  time.Time
	rateLimitDelay time.Duration
	retryCount     int
	now            func() time.Time
	sleep          func(context.Context, time.Duration) error
	rateLimitRoll  func() int

	guestMu    sync.Mutex
	guestToken string
}

type xAPISession struct {
	owner      *xAPIClient
	httpClient *http.Client
	authToken  string
}

type xAPIErrorEnvelope struct {
	Errors []xAPIError `json:"errors"`
}

type xAPIError struct {
	Message string `json:"message"`
	Name    string `json:"name"`
}

type xUserByScreenNameEnvelope struct {
	Data struct {
		User struct {
			Result xUserResult `json:"result"`
		} `json:"user"`
	} `json:"data"`
	Errors []xAPIError `json:"errors"`
}

type xUserMediaEnvelope struct {
	Data struct {
		User struct {
			Result xUserMediaResult `json:"result"`
		} `json:"user"`
	} `json:"data"`
	Errors []xAPIError `json:"errors"`
}

type xUserMediaResult struct {
	TypeName string `json:"__typename"`
	Timeline struct {
		Timeline struct {
			Instructions []xTimelineInstruction `json:"instructions"`
		} `json:"timeline"`
	} `json:"timeline"`
}

type xUserResult struct {
	TypeName     string            `json:"__typename"`
	RestID       string            `json:"rest_id"`
	Avatar       xAvatar           `json:"avatar"`
	Core         xUserCore         `json:"core"`
	Legacy       xUserLegacy       `json:"legacy"`
	Location     xUserLocation     `json:"location"`
	Privacy      xUserPrivacy      `json:"privacy"`
	Verification xUserVerification `json:"verification"`
}

type xAvatar struct {
	ImageURL string `json:"image_url"`
}

type xUserCore struct {
	CreatedAt  string `json:"created_at"`
	Name       string `json:"name"`
	ScreenName string `json:"screen_name"`
}

type xUserLegacy struct {
	Description     string `json:"description"`
	FavouritesCount int    `json:"favourites_count"`
	FollowersCount  int    `json:"followers_count"`
	FriendsCount    int    `json:"friends_count"`
	ListedCount     int    `json:"listed_count"`
	MediaCount      int    `json:"media_count"`
	StatusesCount   int    `json:"statuses_count"`
	ProfileBanner   string `json:"profile_banner_url"`
	URL             string `json:"url"`
	Entities        struct {
		URL struct {
			URLs []struct {
				ExpandedURL string `json:"expanded_url"`
				URL         string `json:"url"`
			} `json:"urls"`
		} `json:"url"`
	} `json:"entities"`
}

type xUserLocation struct {
	Location string `json:"location"`
}

type xUserPrivacy struct {
	Protected bool `json:"protected"`
}

type xUserVerification struct {
	Verified bool `json:"verified"`
}

type xTimelineInstruction struct {
	Type          string                `json:"type"`
	Entries       []xTimelineEntry      `json:"entries"`
	Entry         xTimelineEntry        `json:"entry"`
	ModuleEntryID string                `json:"moduleEntryId"`
	ModuleItems   []xTimelineModuleItem `json:"moduleItems"`
}

type xTimelineEntry struct {
	EntryID string                `json:"entryId"`
	Content xTimelineEntryContent `json:"content"`
}

type xTimelineEntryContent struct {
	TypeName    string                `json:"__typename"`
	Value       string                `json:"value"`
	CursorType  string                `json:"cursorType"`
	Items       []xTimelineModuleItem `json:"items"`
	ItemContent xTimelineItemContent  `json:"itemContent"`
}

type xTimelineModuleItem struct {
	EntryID string `json:"entryId"`
	Item    struct {
		ItemContent xTimelineItemContent `json:"itemContent"`
	} `json:"item"`
}

type xTimelineItemContent struct {
	TypeName         string          `json:"__typename"`
	ItemType         string          `json:"itemType"`
	PromotedMetadata json.RawMessage `json:"promotedMetadata"`
	TweetResults     struct {
		Result xTweetResult `json:"result"`
	} `json:"tweet_results"`
}

type xTweetResult struct {
	TypeName           string        `json:"__typename"`
	Tweet              *xTweetResult `json:"tweet,omitempty"`
	RestID             string        `json:"rest_id,omitempty"`
	Core               xTweetCore    `json:"core"`
	Legacy             xTweetLegacy  `json:"legacy"`
	QuotedStatusResult *struct {
		Result xTweetResult `json:"result"`
	} `json:"quoted_status_result,omitempty"`
	NoteTweet *xNoteTweet     `json:"note_tweet,omitempty"`
	Tombstone json.RawMessage `json:"tombstone,omitempty"`
}

type xTweetCore struct {
	UserResults struct {
		Result xUserResult `json:"result"`
	} `json:"user_results"`
}

type xTweetLegacy struct {
	BookmarkCount         int               `json:"bookmark_count"`
	ConversationIDStr     string            `json:"conversation_id_str"`
	CreatedAt             string            `json:"created_at"`
	Entities              xTweetEntities    `json:"entities"`
	ExtendedEntities      xExtendedEntities `json:"extended_entities"`
	FavoriteCount         int               `json:"favorite_count"`
	FullText              string            `json:"full_text"`
	Lang                  string            `json:"lang"`
	PossiblySensitive     bool              `json:"possibly_sensitive"`
	QuoteCount            int               `json:"quote_count"`
	ReplyCount            int               `json:"reply_count"`
	RetweetCount          int               `json:"retweet_count"`
	Source                string            `json:"source"`
	RetweetedStatusResult *struct {
		Result xTweetResult `json:"result"`
	} `json:"retweeted_status_result,omitempty"`
}

type xTweetEntities struct {
	Hashtags []struct {
		Text string `json:"text"`
	} `json:"hashtags"`
}

type xExtendedEntities struct {
	Media []xMediaEntity `json:"media"`
}

type xMediaEntity struct {
	Type          string        `json:"type"`
	ExtAltText    string        `json:"ext_alt_text"`
	MediaURLHTTPS string        `json:"media_url_https"`
	OriginalInfo  xOriginalInfo `json:"original_info"`
	VideoInfo     *xVideoInfo   `json:"video_info,omitempty"`
}

type xOriginalInfo struct {
	Width  int `json:"width"`
	Height int `json:"height"`
}

type xVideoInfo struct {
	DurationMillis int             `json:"duration_millis"`
	Variants       []xVideoVariant `json:"variants"`
}

type xVideoVariant struct {
	Bitrate     int    `json:"bitrate"`
	ContentType string `json:"content_type"`
	URL         string `json:"url"`
}

type xNoteTweet struct {
	NoteTweetResults struct {
		Result struct {
			Text string `json:"text"`
		} `json:"result"`
	} `json:"note_tweet_results"`
}

type xParsedMediaPage struct {
	Items        []CLIMediaItem
	Cursor       string
	RawItemCount int
}

type xFallbackError struct {
	stage        string
	code         string
	partialParse bool
	err          error
}

type xFallbackMetadata struct {
	Stage        string
	Code         string
	PartialParse bool
}

type xPublicMediaDiagnosticLogEntry struct {
	Event          string `json:"event"`
	Username       string `json:"username,omitempty"`
	MediaType      string `json:"media_type,omitempty"`
	AuthMode       string `json:"auth_mode,omitempty"`
	Stage          string `json:"stage,omitempty"`
	FallbackCode   string `json:"fallback_code,omitempty"`
	CursorPresent  bool   `json:"cursor_present"`
	PageItemCount  int    `json:"page_item_count,omitempty"`
	MediaItemCount int    `json:"media_item_count,omitempty"`
	PartialParse   bool   `json:"partial_parse"`
	Success        bool   `json:"success"`
	ElapsedMS      int64  `json:"elapsed_ms"`
	Error          string `json:"error,omitempty"`
}

func (e *xFallbackError) Error() string {
	if e == nil || e.err == nil {
		return ""
	}
	return e.err.Error()
}

func (e *xFallbackError) Unwrap() error {
	if e == nil {
		return nil
	}
	return e.err
}

func defaultXAPIClient() (*xAPIClient, error) {
	defaultXAPIClientOnce.Do(func() {
		defaultXAPIClientInst, defaultXAPIClientErr = newXAPIClient()
	})
	return defaultXAPIClientInst, defaultXAPIClientErr
}

func newXAPIClient() (*xAPIClient, error) {
	proxyURL, err := GetProxyURL("")
	if err != nil {
		return nil, err
	}

	transport := &http.Transport{
		Proxy:                 http.ProxyURL(proxyURL),
		ForceAttemptHTTP2:     true,
		MaxIdleConns:          32,
		MaxIdleConnsPerHost:   8,
		IdleConnTimeout:       90 * time.Second,
		TLSHandshakeTimeout:   10 * time.Second,
		ExpectContinueTimeout: time.Second,
		ResponseHeaderTimeout: 20 * time.Second,
	}

	return &xAPIClient{
		transport:      transport,
		timeout:        xClientRequestTimeout,
		rateLimitDelay: xRateLimitCooldown,
		retryCount:     xRateLimitRetryCount,
		now:            time.Now,
		sleep:          xContextSleep,
		rateLimitRoll: func() int {
			return mathrand.Intn(5) + 1
		},
	}, nil
}

func (c *xAPIClient) extractPublicMediaTimeline(ctx context.Context, req TimelineRequest) (response *TwitterResponse, err error) {
	startedAt := time.Now()
	logEntry := xPublicMediaDiagnosticLogEntry{
		Event:     "x_public_media_request",
		Username:  cleanUsername(req.Username),
		MediaType: xNormalizeRequestedMediaType(req.MediaType),
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
		appendXPublicMediaDiagnosticLog(logEntry)
	}()

	session, err := c.newSession(strings.TrimSpace(req.AuthToken))
	if err != nil {
		return nil, err
	}

	user, err := session.resolveUserByScreenName(ctx, cleanUsername(req.Username))
	if err != nil {
		return nil, err
	}
	logEntry.Stage = "fetch"

	page, err := session.fetchUserMediaPage(ctx, user.RestID, xResolveTimelineCount(req.BatchSize), strings.TrimSpace(req.Cursor))
	if err != nil {
		return nil, err
	}
	logEntry.Stage = "parse"

	parsed, err := parseXMediaTimelinePage(page, strings.TrimSpace(req.MediaType))
	if err != nil {
		if metadata, ok := xFallbackDetails(err); ok {
			logEntry.PartialParse = metadata.PartialParse
		}
		return nil, err
	}

	logEntry.PageItemCount = parsed.RawItemCount
	logEntry.MediaItemCount = len(parsed.Items)
	logEntry.CursorPresent = strings.TrimSpace(parsed.Cursor) != ""
	logEntry.Stage = "normalize"

	response, err = buildPublicMediaTimelineResponseFromParsed(req, user, parsed)
	return response, err
}

func (c *xAPIClient) newSession(authToken string) (*xAPISession, error) {
	jar, err := cookiejar.New(nil)
	if err != nil {
		return nil, xWrapFallback("lookup", "cookie_jar_init_failed", "failed to initialize x session cookies", err)
	}

	session := &xAPISession{
		owner: c,
		httpClient: &http.Client{
			Transport: c.transport,
			Timeout:   c.timeout,
			Jar:       jar,
		},
		authToken: strings.TrimSpace(authToken),
	}

	if session.authToken != "" {
		csrfToken, err := xGenerateCSRFToken()
		if err != nil {
			return nil, xWrapFallback("lookup", "csrf_seed_failed", "failed to seed authenticated csrf token", err)
		}
		session.seedAuthCookies(csrfToken)
	}

	return session, nil
}

func (c *xAPIClient) newAuthenticatedSession(authToken string) (*xAPISession, error) {
	if strings.TrimSpace(authToken) == "" {
		return nil, xWrapFallback("lookup", "missing_auth_token", "private timeline extraction requires an auth token", nil)
	}
	return c.newSession(authToken)
}

func (s *xAPISession) seedAuthCookies(csrfToken string) {
	baseURL, _ := url.Parse(xRootURL)
	s.httpClient.Jar.SetCookies(baseURL, []*http.Cookie{
		{
			Name:  "auth_token",
			Value: s.authToken,
			Path:  "/",
		},
		{
			Name:  "ct0",
			Value: csrfToken,
			Path:  "/",
		},
	})
}

func (s *xAPISession) resolveUserByScreenName(ctx context.Context, screenName string) (xUserResult, error) {
	params := url.Values{}
	params.Set("variables", xMustJSONString(map[string]any{
		"screen_name":           screenName,
		"withGrokTranslatedBio": false,
	}))
	params.Set("features", xMustJSONString(map[string]any{
		"hidden_profile_subscriptions_enabled":                              true,
		"payments_enabled":                                                  false,
		"rweb_xchat_enabled":                                                false,
		"profile_label_improvements_pcf_label_in_post_enabled":              true,
		"rweb_tipjar_consumption_enabled":                                   true,
		"verified_phone_label_enabled":                                      false,
		"highlights_tweets_tab_ui_enabled":                                  true,
		"responsive_web_twitter_article_notes_tab_enabled":                  true,
		"subscriptions_feature_can_gift_premium":                            true,
		"creator_subscriptions_tweet_preview_api_enabled":                   true,
		"responsive_web_graphql_skip_user_profile_image_extensions_enabled": false,
		"responsive_web_graphql_timeline_navigation_enabled":                true,
		"subscriptions_verification_info_is_identity_verified_enabled":      true,
		"subscriptions_verification_info_verified_since_enabled":            true,
	}))
	params.Set("fieldToggles", xMustJSONString(map[string]any{
		"withAuxiliaryUserLabels": true,
	}))

	var envelope xUserByScreenNameEnvelope
	if err := s.doJSON(ctx, "lookup", http.MethodGet, xAPIRootURL, xUserByScreenNamePath, params, true, &envelope); err != nil {
		return xUserResult{}, err
	}
	return xResolveUserLookupResult(envelope)
}

func (s *xAPISession) fetchUserMediaPage(ctx context.Context, userID string, count int, cursor string) (*xUserMediaEnvelope, error) {
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
	params.Set("features", xMustJSONString(map[string]any{
		"payments_enabled":   false,
		"rweb_xchat_enabled": false,
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
	}))
	params.Set("fieldToggles", xMustJSONString(map[string]any{
		"withArticlePlainText": false,
	}))

	var envelope xUserMediaEnvelope
	if err := s.doJSON(ctx, "fetch", http.MethodGet, xAPIRootURL, xUserMediaPath, params, true, &envelope); err != nil {
		return nil, err
	}
	if len(envelope.Errors) > 0 {
		return nil, xWrapFallback("fetch", "api_errors", "x api returned media timeline errors", xErrorsAsError(envelope.Errors))
	}
	if len(envelope.Data.User.Result.Timeline.Timeline.Instructions) == 0 {
		return nil, xWrapFallback("fetch", "missing_instructions", "x api media timeline returned no instructions", nil)
	}
	return &envelope, nil
}

func (s *xAPISession) doJSON(
	ctx context.Context,
	stage string,
	method string,
	root string,
	endpoint string,
	params url.Values,
	authRequired bool,
	out any,
) error {
	if err := contextError(ctx); err != nil {
		return err
	}

	if authRequired && s.authToken == "" {
		guestToken, err := s.ensureGuestToken(ctx, stage)
		if err != nil {
			return err
		}
		_ = guestToken
	}

	requestURL := root + endpoint
	if encoded := params.Encode(); encoded != "" {
		requestURL += "?" + encoded
	}

	maxRetries := s.owner.maxRetryCount()
	for attempt := 0; ; attempt++ {
		if err := s.owner.waitForSharedCooldown(ctx); err != nil {
			return xWrapFallback(stage, "request_rate_limit_wait_failed", "x api request was canceled while waiting for rate-limit cooldown", err)
		}

		req, err := http.NewRequestWithContext(ctx, method, requestURL, nil)
		if err != nil {
			return xWrapFallback(stage, "request_build_failed", "failed to build x api request", err)
		}
		s.applyHeaders(req, authRequired)

		resp, err := s.httpClient.Do(req)
		if err != nil {
			return xWrapFallback(stage, "request_failed", "x api request failed", err)
		}

		body, readErr := io.ReadAll(resp.Body)
		resp.Body.Close()
		if readErr != nil {
			return xWrapFallback(stage, "response_read_failed", "failed to read x api response", readErr)
		}

		if s.owner.shouldPreemptRateLimit(resp.Header) {
			s.owner.noteRateLimitedUntil(s.owner.resolveRateLimitUntil(resp.Header))
			if attempt < maxRetries {
				continue
			}
		}

		if resp.StatusCode == http.StatusTooManyRequests && attempt < maxRetries {
			s.owner.noteRateLimitedUntil(s.owner.resolveRateLimitUntil(resp.Header))
			continue
		}
		if resp.StatusCode >= http.StatusBadRequest {
			return s.classifyHTTPError(stage, resp.StatusCode, endpoint, body, resp.Header)
		}
		if len(strings.TrimSpace(string(body))) == 0 {
			return xWrapFallback(stage, "response_empty", "x api returned an empty response body", nil)
		}
		if err := json.Unmarshal(body, out); err != nil {
			return xWrapFallback(stage, "response_malformed_json", "x api returned malformed json", err)
		}

		return nil
	}
}

func (s *xAPISession) applyHeaders(req *http.Request, authRequired bool) {
	req.Header.Set("User-Agent", xFirefoxLinuxUserAgent)
	req.Header.Set("Accept", "*/*")
	req.Header.Set("Accept-Language", "en-US,en;q=0.5")
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Referer", xRootURL)
	req.Header.Set("Authorization", xAuthBearerToken)
	req.Header.Set("X-Twitter-Client-Language", "en")
	req.Header.Set("X-Twitter-Active-User", "yes")
	req.Header.Set("Sec-Fetch-Dest", "empty")
	req.Header.Set("Sec-Fetch-Mode", "cors")
	req.Header.Set("Sec-Fetch-Site", "same-origin")
	req.Header.Set("TE", "trailers")

	if !authRequired {
		return
	}
	if s.authToken != "" {
		req.Header.Set("X-Twitter-Auth-Type", "OAuth2Session")
		if csrfToken := s.currentCSRFToken(); csrfToken != "" {
			req.Header.Set("X-Csrf-Token", csrfToken)
		}
		return
	}
	if guestToken := s.cachedGuestToken(); guestToken != "" {
		req.Header.Set("X-Guest-Token", guestToken)
	}
}

func (s *xAPISession) ensureGuestToken(ctx context.Context, stage string) (string, error) {
	if token := s.cachedGuestToken(); token != "" {
		return token, nil
	}

	maxRetries := s.owner.maxRetryCount()
	for attempt := 0; ; attempt++ {
		req, err := http.NewRequestWithContext(ctx, http.MethodPost, xGuestAPIRootURL+xGuestActivatePath, nil)
		if err != nil {
			return "", xWrapFallback(stage, "guest_request_build_failed", "failed to build guest token request", err)
		}
		req.Header.Set("User-Agent", xFirefoxLinuxUserAgent)
		req.Header.Set("Accept", "*/*")
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Authorization", xAuthBearerToken)

		if err := s.owner.waitForSharedCooldown(ctx); err != nil {
			return "", xWrapFallback(stage, "guest_rate_limit_wait_failed", "guest token request was canceled while waiting for rate-limit cooldown", err)
		}

		resp, err := s.httpClient.Do(req)
		if err != nil {
			return "", xWrapFallback(stage, "guest_request_failed", "guest token request failed", err)
		}

		body, readErr := io.ReadAll(resp.Body)
		resp.Body.Close()
		if readErr != nil {
			return "", xWrapFallback(stage, "guest_response_read_failed", "failed to read guest token response", readErr)
		}
		if resp.StatusCode == http.StatusTooManyRequests && attempt < maxRetries {
			s.owner.noteRateLimitedUntil(s.owner.resolveRateLimitUntil(resp.Header))
			continue
		}
		if resp.StatusCode >= http.StatusBadRequest {
			return "", s.classifyHTTPError(stage, resp.StatusCode, xGuestActivatePath, body, resp.Header)
		}

		var payload struct {
			GuestToken string `json:"guest_token"`
		}
		if err := json.Unmarshal(body, &payload); err != nil {
			return "", xWrapFallback(stage, "guest_response_malformed_json", "guest token response was not valid json", err)
		}
		if strings.TrimSpace(payload.GuestToken) == "" {
			return "", xWrapFallback(stage, "guest_token_missing", "guest token response did not include a token", nil)
		}

		s.owner.guestMu.Lock()
		s.owner.guestToken = payload.GuestToken
		s.owner.guestMu.Unlock()
		return payload.GuestToken, nil
	}
}

func (s *xAPISession) cachedGuestToken() string {
	s.owner.guestMu.Lock()
	defer s.owner.guestMu.Unlock()
	return strings.TrimSpace(s.owner.guestToken)
}

func (s *xAPISession) currentCSRFToken() string {
	baseURL, _ := url.Parse(xRootURL)
	for _, cookie := range s.httpClient.Jar.Cookies(baseURL) {
		if cookie != nil && cookie.Name == "ct0" && strings.TrimSpace(cookie.Value) != "" {
			return cookie.Value
		}
	}
	return ""
}

func (s *xAPISession) classifyHTTPError(stage string, statusCode int, endpoint string, body []byte, headers http.Header) error {
	message := xFirstAPIErrorMessage(body)
	switch statusCode {
	case http.StatusUnauthorized:
		if strings.Contains(endpoint, xGuestActivatePath) {
			return xWrapFallback(stage, "http_unauthorized", "guest token request was unauthorized", xStatusError(statusCode, message))
		}
		return xWrapFallback(stage, "http_unauthorized", "x api request was unauthorized", xStatusError(statusCode, message))
	case http.StatusForbidden:
		return xWrapFallback(stage, "http_forbidden", "x api request was forbidden", xStatusError(statusCode, message))
	case http.StatusNotFound:
		if strings.Contains(endpoint, xUserMediaPath) && s.authToken == "" {
			return xWrapFallback(stage, "http_not_found", "guest public media fetch requires authenticated cookies or additional anti-bot headers", xStatusError(statusCode, message))
		}
		return xWrapFallback(stage, "http_not_found", "x api endpoint returned not found", xStatusError(statusCode, message))
	case http.StatusTooManyRequests:
		return xWrapFallback(stage, "http_rate_limited", xRateLimitedReason(s.owner.resolveRateLimitWait(headers)), xStatusError(statusCode, message))
	default:
		return xWrapFallback(stage, "http_status", fmt.Sprintf("x api request failed with status %d", statusCode), xStatusError(statusCode, message))
	}
}

func (c *xAPIClient) waitForSharedCooldown(ctx context.Context) error {
	if err := contextError(ctx); err != nil {
		return err
	}
	if c == nil {
		return nil
	}

	nowFn := c.now
	if nowFn == nil {
		nowFn = time.Now
	}
	sleepFn := c.sleep
	if sleepFn == nil {
		sleepFn = xContextSleep
	}

	c.pacingMu.Lock()
	cooldownUntil := c.cooldownUntil
	c.pacingMu.Unlock()

	waitFor := cooldownUntil.Sub(nowFn())
	if waitFor <= 0 {
		return nil
	}
	return sleepFn(ctx, waitFor)
}

func (c *xAPIClient) maxRetryCount() int {
	if c == nil || c.retryCount < 0 {
		return xRateLimitRetryCount
	}
	return c.retryCount
}

func (c *xAPIClient) shouldPreemptRateLimit(headers http.Header) bool {
	if c == nil || headers == nil {
		return false
	}
	if _, ok := xParseRateLimitReset(headers, c.now); !ok {
		return false
	}
	rawRemaining := strings.TrimSpace(headers.Get("x-rate-limit-remaining"))
	if rawRemaining == "" {
		return false
	}
	remaining, err := strconv.Atoi(rawRemaining)
	if err != nil || remaining >= 6 {
		return false
	}

	roll := 1
	if c.rateLimitRoll != nil {
		roll = c.rateLimitRoll()
	}
	if roll < 1 {
		roll = 1
	}
	if roll > 5 {
		roll = 5
	}
	return remaining <= roll
}

func (c *xAPIClient) resolveRateLimitUntil(headers http.Header) time.Time {
	if until, ok := xParseRateLimitReset(headers, c.now); ok {
		return until
	}
	delay := xRateLimitCooldown
	if c != nil && c.rateLimitDelay > 0 {
		delay = c.rateLimitDelay
	}
	if retryAfter := xParseRetryAfter(headers); retryAfter > 0 {
		delay = retryAfter + xRateLimitSafetyMargin
	}
	nowFn := time.Now
	if c != nil && c.now != nil {
		nowFn = c.now
	}
	return nowFn().Add(delay)
}

func (c *xAPIClient) resolveRateLimitWait(headers http.Header) time.Duration {
	nowFn := time.Now
	if c != nil && c.now != nil {
		nowFn = c.now
	}
	waitFor := c.resolveRateLimitUntil(headers).Sub(nowFn())
	if waitFor <= 0 {
		return xRateLimitSafetyMargin
	}
	return waitFor
}

func (c *xAPIClient) noteRateLimitedUntil(until time.Time) {
	if c == nil || until.IsZero() {
		return
	}

	c.pacingMu.Lock()
	defer c.pacingMu.Unlock()
	if until.After(c.cooldownUntil) {
		c.cooldownUntil = until
	}
}

func parseXMediaTimelinePage(envelope *xUserMediaEnvelope, mediaType string) (*xParsedMediaPage, error) {
	if envelope == nil {
		return nil, xWrapFallback("parse", "nil_envelope", "media timeline envelope was nil", nil)
	}

	instructions := envelope.Data.User.Result.Timeline.Timeline.Instructions
	if len(instructions) == 0 {
		return nil, xWrapFallback("parse", "missing_instructions", "media timeline response contained no instructions", nil)
	}

	filter := xNormalizeRequestedMediaType(mediaType)
	seen := make(map[string]struct{})
	items := make([]CLIMediaItem, 0, 8)
	rawCount := 0
	cursor := ""

	appendModuleItems := func(moduleItems []xTimelineModuleItem) error {
		for _, moduleItem := range moduleItems {
			mediaItems, err := parseXTimelineModuleItem(moduleItem, filter)
			if err != nil {
				if rawCount > 0 || len(items) > 0 {
					err = xMarkPartialParse(err)
				}
				return err
			}
			rawCount += len(mediaItems.raw)
			for _, mediaItem := range mediaItems.filtered {
				key := fmt.Sprintf("%d|%s|%s", mediaItem.TweetID, mediaItem.URL, mediaItem.Type)
				if _, exists := seen[key]; exists {
					continue
				}
				seen[key] = struct{}{}
				items = append(items, mediaItem)
			}
		}
		return nil
	}

	for _, instruction := range instructions {
		switch instruction.Type {
		case "TimelineAddEntries":
			for _, entry := range instruction.Entries {
				entryID := strings.TrimSpace(entry.EntryID)
				switch {
				case strings.HasPrefix(entryID, xMediaTimelineModuleKey):
					if err := appendModuleItems(entry.Content.Items); err != nil {
						return nil, err
					}
				case strings.HasPrefix(entryID, "cursor-bottom-"):
					cursor = strings.TrimSpace(entry.Content.Value)
				}
			}
		case "TimelineAddToModule":
			if strings.HasPrefix(strings.TrimSpace(instruction.ModuleEntryID), xMediaTimelineModuleKey) {
				if err := appendModuleItems(instruction.ModuleItems); err != nil {
					return nil, err
				}
			}
		case "TimelineReplaceEntry":
			if strings.HasPrefix(strings.TrimSpace(instruction.Entry.EntryID), "cursor-bottom-") {
				cursor = strings.TrimSpace(instruction.Entry.Content.Value)
			}
		}
	}

	return &xParsedMediaPage{
		Items:        items,
		Cursor:       cursor,
		RawItemCount: rawCount,
	}, nil
}

func buildPublicMediaTimelineResponse(req TimelineRequest, user xUserResult, page *xUserMediaEnvelope) (*TwitterResponse, error) {
	parsed, err := parseXMediaTimelinePage(page, strings.TrimSpace(req.MediaType))
	if err != nil {
		return nil, err
	}
	return buildPublicMediaTimelineResponseFromParsed(req, user, parsed)
}

func buildPublicMediaTimelineResponseFromParsed(req TimelineRequest, user xUserResult, parsed *xParsedMediaPage) (*TwitterResponse, error) {
	if parsed == nil {
		return nil, xWrapFallback("normalize", "nil_parsed_page", "parsed media timeline page was nil", nil)
	}
	if parsed.RawItemCount > 0 && strings.TrimSpace(parsed.Cursor) == "" {
		return nil, xWrapFallback("normalize", "missing_cursor", "media timeline returned items without a continuation cursor", nil)
	}

	timeline := make([]TimelineEntry, 0, len(parsed.Items))
	for _, item := range parsed.Items {
		timeline = append(timeline, convertToTimelineEntry(item))
	}

	accountUser := parseXUserInfo(user)
	accountInfo := AccountInfo{}
	applyAccountInfoFromUser(&accountInfo, accountUser, true)

	completed := strings.TrimSpace(parsed.Cursor) == ""
	return buildTwitterResponse(accountInfo, timeline, req.Page, req.BatchSize, parsed.Cursor, completed), nil
}

type xParsedModuleItems struct {
	raw      []CLIMediaItem
	filtered []CLIMediaItem
}

func parseXTimelineModuleItem(moduleItem xTimelineModuleItem, filter string) (xParsedModuleItems, error) {
	itemContent := moduleItem.Item.ItemContent
	if len(itemContent.PromotedMetadata) > 0 && string(itemContent.PromotedMetadata) != "null" {
		return xParsedModuleItems{}, nil
	}

	tweet, err := unwrapXTweetResult(itemContent.TweetResults.Result)
	if err != nil {
		return xParsedModuleItems{}, err
	}
	if strings.TrimSpace(tweet.RestID) == "" {
		return xParsedModuleItems{}, nil
	}
	mediaItems, err := buildCLIMediaItemsFromTweet(tweet)
	if err != nil {
		return xParsedModuleItems{}, err
	}

	filtered := mediaItems
	if filter != "" && filter != "all" {
		filtered = make([]CLIMediaItem, 0, len(mediaItems))
		for _, mediaItem := range mediaItems {
			if xMatchesRequestedMediaType(mediaItem.Type, filter) {
				filtered = append(filtered, mediaItem)
			}
		}
	}

	return xParsedModuleItems{
		raw:      mediaItems,
		filtered: filtered,
	}, nil
}

func unwrapXTweetResult(result xTweetResult) (xTweetResult, error) {
	current := result
	for current.Tweet != nil {
		current = *current.Tweet
	}
	if len(current.Tombstone) > 0 && string(current.Tombstone) != "null" {
		return xTweetResult{}, nil
	}
	if strings.TrimSpace(current.RestID) == "" {
		return xTweetResult{}, xWrapFallback("parse", "missing_rest_id", "tweet result did not include a rest_id", nil)
	}
	if strings.TrimSpace(current.Core.UserResults.Result.RestID) == "" {
		return xTweetResult{}, xWrapFallback("parse", "missing_core_user", "tweet result did not include core user data", nil)
	}
	return current, nil
}

func buildCLIMediaItemsFromTweet(tweet xTweetResult) ([]CLIMediaItem, error) {
	if strings.TrimSpace(tweet.RestID) == "" {
		return nil, xWrapFallback("parse", "missing_tweet_id", "tweet result did not include a tweet id", nil)
	}

	tweetID, err := xParseTweetID(tweet.RestID)
	if err != nil {
		return nil, xWrapFallback("parse", "invalid_tweet_id", "tweet id could not be parsed", err)
	}

	user := parseXUserInfo(tweet.Core.UserResults.Result)
	author := user
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
	hashtags := make([]string, 0, len(tweet.Legacy.Entities.Hashtags))
	for _, hashtag := range tweet.Legacy.Entities.Hashtags {
		if text := strings.TrimSpace(hashtag.Text); text != "" {
			hashtags = append(hashtags, text)
		}
	}
	_ = hashtags

	items := make([]CLIMediaItem, 0, len(entities))
	for _, entity := range entities {
		item, ok, err := buildCLIMediaItemFromEntity(tweetID, date, content, author, user, tweet, entity, conversationID)
		if err != nil {
			return nil, err
		}
		if ok {
			items = append(items, item)
		}
	}

	return items, nil
}

func buildCLIMediaItemFromEntity(
	tweetID TweetIDString,
	date string,
	content string,
	author UserInfo,
	user UserInfo,
	tweet xTweetResult,
	entity xMediaEntity,
	conversationID TweetIDString,
) (CLIMediaItem, bool, error) {
	item := CLIMediaItem{
		TweetID:        tweetID,
		ConversationID: conversationID,
		Date:           date,
		Author:         author,
		User:           user,
		Content:        content,
		FavoriteCount:  tweet.Legacy.FavoriteCount,
		RetweetCount:   tweet.Legacy.RetweetCount,
		ReplyCount:     tweet.Legacy.ReplyCount,
		QuoteCount:     tweet.Legacy.QuoteCount,
		BookmarkCount:  tweet.Legacy.BookmarkCount,
		Source:         xNormalizeSource(tweet.Legacy.Source),
		Sensitive:      tweet.Legacy.PossiblySensitive,
	}

	switch strings.ToLower(strings.TrimSpace(entity.Type)) {
	case "photo":
		item.URL = xBuildPhotoURL(entity.MediaURLHTTPS)
		item.Extension = xMediaExtensionFromURL(item.URL)
		item.Type = "photo"
		item.Width = entity.OriginalInfo.Width
		item.Height = entity.OriginalInfo.Height
		return item, item.URL != "", nil
	case "video", "animated_gif":
		if entity.VideoInfo == nil {
			return CLIMediaItem{}, false, xWrapFallback("parse", "missing_video_info", "video media entity did not include video variants", nil)
		}
		variant, ok := xSelectPreferredVideoVariant(entity.VideoInfo.Variants)
		if !ok {
			return CLIMediaItem{}, false, xWrapFallback("parse", "missing_video_variant", "video media entity did not include a playable mp4 variant", nil)
		}
		item.URL = variant.URL
		item.Extension = xMediaExtensionFromURL(variant.URL)
		item.Type = strings.ToLower(strings.TrimSpace(entity.Type))
		item.Width = entity.OriginalInfo.Width
		item.Height = entity.OriginalInfo.Height
		item.Bitrate = variant.Bitrate
		item.Duration = float64(entity.VideoInfo.DurationMillis) / 1000
		return item, true, nil
	default:
		return CLIMediaItem{}, false, nil
	}
}

func parseXUserInfo(user xUserResult) UserInfo {
	date := ""
	if parsedDate, err := xParseUserDate(user.Core.CreatedAt); err == nil {
		date = parsedDate
	}

	urlValue := strings.TrimSpace(user.Legacy.URL)
	if len(user.Legacy.Entities.URL.URLs) > 0 && strings.TrimSpace(user.Legacy.Entities.URL.URLs[0].ExpandedURL) != "" {
		urlValue = strings.TrimSpace(user.Legacy.Entities.URL.URLs[0].ExpandedURL)
	}

	return UserInfo{
		ID:              xParseInt64Default(user.RestID),
		Name:            strings.TrimSpace(user.Core.ScreenName),
		Nick:            strings.TrimSpace(user.Core.Name),
		Location:        strings.TrimSpace(user.Location.Location),
		Date:            date,
		Verified:        user.Verification.Verified,
		Protected:       user.Privacy.Protected,
		ProfileBanner:   strings.TrimSpace(user.Legacy.ProfileBanner),
		ProfileImage:    xNormalizeProfileImageURL(user.Avatar.ImageURL),
		FavouritesCount: user.Legacy.FavouritesCount,
		FollowersCount:  user.Legacy.FollowersCount,
		FriendsCount:    user.Legacy.FriendsCount,
		ListedCount:     user.Legacy.ListedCount,
		MediaCount:      user.Legacy.MediaCount,
		StatusesCount:   user.Legacy.StatusesCount,
		Description:     strings.TrimSpace(user.Legacy.Description),
		URL:             urlValue,
	}
}

func xResolveTimelineCount(batchSize int) int {
	if batchSize > 0 {
		return batchSize
	}
	return xDefaultTimelineCount
}

func xGenerateCSRFToken() (string, error) {
	bytes := make([]byte, 16)
	if _, err := cryptorand.Read(bytes); err != nil {
		return "", err
	}
	return hex.EncodeToString(bytes), nil
}

func xMustJSONString(value any) string {
	data, err := json.Marshal(value)
	if err != nil {
		panic(err)
	}
	return string(data)
}

func xErrorsAsError(apiErrors []xAPIError) error {
	if len(apiErrors) == 0 {
		return nil
	}
	messages := make([]string, 0, len(apiErrors))
	for _, apiErr := range apiErrors {
		if message := strings.TrimSpace(apiErr.Message); message != "" {
			messages = append(messages, message)
		} else if name := strings.TrimSpace(apiErr.Name); name != "" {
			messages = append(messages, name)
		}
	}
	if len(messages) == 0 {
		return nil
	}
	return errors.New(strings.Join(messages, "; "))
}

func xResolveUserLookupResult(envelope xUserByScreenNameEnvelope) (xUserResult, error) {
	if len(envelope.Errors) > 0 {
		return xUserResult{}, xWrapFallback("lookup", "api_errors", "x api returned user lookup errors", xErrorsAsError(envelope.Errors))
	}
	if strings.TrimSpace(envelope.Data.User.Result.RestID) == "" {
		return xUserResult{}, xWrapFallback("lookup", "missing_user_result", "x api user lookup returned no user result", nil)
	}
	return envelope.Data.User.Result, nil
}

func xWrapFallback(stage string, code string, reason string, err error) error {
	return &xFallbackError{
		stage: strings.TrimSpace(stage),
		code:  strings.TrimSpace(code),
		err:   newEngineFallbackRequiredError("go-twitter", reason, err),
	}
}

func xMarkPartialParse(err error) error {
	var fallbackErr *xFallbackError
	if !errors.As(err, &fallbackErr) || fallbackErr == nil {
		return err
	}
	cloned := *fallbackErr
	cloned.partialParse = true
	return &cloned
}

func xFallbackDetails(err error) (xFallbackMetadata, bool) {
	var fallbackErr *xFallbackError
	if !errors.As(err, &fallbackErr) || fallbackErr == nil {
		return xFallbackMetadata{}, false
	}
	return xFallbackMetadata{
		Stage:        fallbackErr.stage,
		Code:         fallbackErr.code,
		PartialParse: fallbackErr.partialParse,
	}, true
}

func appendXPublicMediaDiagnosticLog(entry xPublicMediaDiagnosticLogEntry) {
	recordXPublicMediaDiagnosticLogEntry(entry)
	data, err := json.Marshal(entry)
	if err != nil {
		return
	}
	_ = AppendBackendDiagnosticLog("info", string(data))
}

func xAuthMode(authToken string) string {
	if strings.TrimSpace(authToken) != "" {
		return "auth"
	}
	return "guest"
}

func xStatusError(statusCode int, message string) error {
	if strings.TrimSpace(message) == "" {
		return fmt.Errorf("status %d", statusCode)
	}
	return fmt.Errorf("status %d: %s", statusCode, message)
}

func xFirstAPIErrorMessage(body []byte) string {
	var envelope xAPIErrorEnvelope
	if err := json.Unmarshal(body, &envelope); err != nil {
		return ""
	}
	if len(envelope.Errors) == 0 {
		return ""
	}
	for _, apiErr := range envelope.Errors {
		if message := strings.TrimSpace(apiErr.Message); message != "" {
			return message
		}
		if name := strings.TrimSpace(apiErr.Name); name != "" {
			return name
		}
	}
	return ""
}

func xParseRetryAfter(headers http.Header) time.Duration {
	if headers == nil {
		return 0
	}

	raw := strings.TrimSpace(headers.Get("Retry-After"))
	if raw == "" {
		return 0
	}
	if seconds, err := strconv.Atoi(raw); err == nil {
		if seconds <= 0 {
			return 0
		}
		return time.Duration(seconds) * time.Second
	}

	if retryAt, err := http.ParseTime(raw); err == nil {
		delay := time.Until(retryAt)
		if delay > 0 {
			return delay
		}
	}
	return 0
}

func xParseRateLimitReset(headers http.Header, nowFn func() time.Time) (time.Time, bool) {
	if headers == nil {
		return time.Time{}, false
	}

	raw := strings.TrimSpace(headers.Get("x-rate-limit-reset"))
	if raw == "" {
		return time.Time{}, false
	}

	resetUnix, err := strconv.ParseInt(raw, 10, 64)
	if err != nil || resetUnix <= 0 {
		return time.Time{}, false
	}

	if nowFn == nil {
		nowFn = time.Now
	}

	until := time.Unix(resetUnix, 0).Add(xRateLimitSafetyMargin)
	if !until.After(nowFn()) {
		return time.Time{}, false
	}
	return until, true
}

func xRateLimitedReason(delay time.Duration) string {
	if delay <= 0 {
		return "x api rate limited the request"
	}
	seconds := int(delay.Round(time.Second) / time.Second)
	if seconds <= 0 {
		seconds = 1
	}
	return fmt.Sprintf("x api rate limited the request; retry after %ds", seconds)
}

func xContextSleep(ctx context.Context, delay time.Duration) error {
	if delay <= 0 {
		return nil
	}
	timer := time.NewTimer(delay)
	defer timer.Stop()

	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
		return nil
	}
}

func xParseTweetDate(raw string) (string, error) {
	parsed, err := time.Parse(time.RubyDate, strings.TrimSpace(raw))
	if err != nil {
		return "", err
	}
	return parsed.UTC().Format("2006-01-02T15:04:05"), nil
}

func xParseUserDate(raw string) (string, error) {
	parsed, err := time.Parse(time.RubyDate, strings.TrimSpace(raw))
	if err != nil {
		return "", err
	}
	return parsed.UTC().Format("2006-01-02 15:04:05"), nil
}

func xParseTweetID(raw string) (TweetIDString, error) {
	value, err := strconv.ParseInt(strings.TrimSpace(raw), 10, 64)
	if err != nil {
		return 0, err
	}
	return TweetIDString(value), nil
}

func xParseOptionalTweetID(raw string) (TweetIDString, error) {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return 0, nil
	}
	return xParseTweetID(trimmed)
}

func xParseInt64Default(raw string) int64 {
	value, err := strconv.ParseInt(strings.TrimSpace(raw), 10, 64)
	if err != nil {
		return 0
	}
	return value
}

func xNormalizeRequestedMediaType(mediaType string) string {
	switch strings.ToLower(strings.TrimSpace(mediaType)) {
	case "", "all":
		return "all"
	case "image":
		return "image"
	case "video":
		return "video"
	case "gif":
		return "gif"
	default:
		return ""
	}
}

func xMatchesRequestedMediaType(actualType string, requestedType string) bool {
	switch requestedType {
	case "all":
		return true
	case "image":
		return strings.EqualFold(strings.TrimSpace(actualType), "photo")
	case "video":
		return strings.EqualFold(strings.TrimSpace(actualType), "video")
	case "gif":
		return strings.EqualFold(strings.TrimSpace(actualType), "animated_gif") || strings.EqualFold(strings.TrimSpace(actualType), "gif")
	default:
		return false
	}
}

func xBuildPhotoURL(mediaURL string) string {
	trimmed := strings.TrimSpace(mediaURL)
	if trimmed == "" {
		return ""
	}
	parsed, err := url.Parse(trimmed)
	if err != nil {
		return trimmed
	}

	fileExt := strings.TrimPrefix(path.Ext(parsed.Path), ".")
	basePath := strings.TrimSuffix(parsed.Path, path.Ext(parsed.Path))
	parsed.Path = basePath

	query := parsed.Query()
	if fileExt != "" {
		query.Set("format", fileExt)
	}
	query.Set("name", "orig")
	parsed.RawQuery = query.Encode()
	return parsed.String()
}

func xMediaExtensionFromURL(rawURL string) string {
	parsed, err := url.Parse(strings.TrimSpace(rawURL))
	if err != nil {
		return ""
	}
	if format := strings.TrimSpace(parsed.Query().Get("format")); format != "" {
		return format
	}
	return strings.TrimPrefix(path.Ext(parsed.Path), ".")
}

func xSelectPreferredVideoVariant(variants []xVideoVariant) (xVideoVariant, bool) {
	var selected xVideoVariant
	found := false
	for _, variant := range variants {
		if !strings.EqualFold(strings.TrimSpace(variant.ContentType), "video/mp4") {
			continue
		}
		if strings.TrimSpace(variant.URL) == "" {
			continue
		}
		if !found || variant.Bitrate > selected.Bitrate {
			selected = variant
			found = true
		}
	}
	return selected, found
}

func xNormalizeProfileImageURL(rawURL string) string {
	normalized := strings.TrimSpace(rawURL)
	for _, marker := range []string{"_normal.", "_bigger.", "_mini."} {
		normalized = strings.Replace(normalized, marker, ".", 1)
	}
	return normalized
}

func xNormalizeSource(raw string) string {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return ""
	}

	var builder strings.Builder
	inTag := false
	for _, r := range trimmed {
		switch r {
		case '<':
			inTag = true
		case '>':
			inTag = false
		default:
			if !inTag {
				builder.WriteRune(r)
			}
		}
	}
	return strings.TrimSpace(html.UnescapeString(builder.String()))
}
