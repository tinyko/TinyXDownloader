package backend

import (
	"bufio"
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
)

// getExecutableName returns the appropriate executable name for the current OS
func getExecutableName() string {
	if runtime.GOOS == "windows" {
		return "extractor.exe"
	}
	return "extractor"
}

var (
	ErrExtractorCanceled = errors.New("extractor canceled")
	errExtractorWorker   = errors.New("extractor worker failure")

	extractorRequestsMu sync.Mutex
	extractorCancels    = make(map[string]func())
	extractorCanceled   = make(map[string]struct{})

	extractorPoolMu sync.Mutex
	extractorPool   *extractorWorkerPool
)

func registerExtractorRequest(requestID string, cancel func()) func() {
	if strings.TrimSpace(requestID) == "" {
		return func() {}
	}

	extractorRequestsMu.Lock()
	delete(extractorCanceled, requestID)
	extractorCancels[requestID] = cancel
	extractorRequestsMu.Unlock()

	return func() {
		extractorRequestsMu.Lock()
		if _, ok := extractorCancels[requestID]; ok {
			delete(extractorCancels, requestID)
		}
		extractorRequestsMu.Unlock()
	}
}

func consumeExtractorRequestCanceled(requestID string) bool {
	if strings.TrimSpace(requestID) == "" {
		return false
	}

	extractorRequestsMu.Lock()
	_, ok := extractorCanceled[requestID]
	if ok {
		delete(extractorCanceled, requestID)
	}
	extractorRequestsMu.Unlock()

	return ok
}

func cancelRegisteredExtractorRequests() {
	extractorRequestsMu.Lock()
	cancels := make([]func(), 0, len(extractorCancels))
	for requestID, cancel := range extractorCancels {
		cancels = append(cancels, cancel)
		extractorCanceled[requestID] = struct{}{}
		delete(extractorCancels, requestID)
	}
	extractorRequestsMu.Unlock()

	for _, cancel := range cancels {
		cancel()
	}
}

// CancelExtractorRequest cancels a specific in-flight extractor request.
func CancelExtractorRequest(requestID string) bool {
	if strings.TrimSpace(requestID) == "" {
		return false
	}

	extractorRequestsMu.Lock()
	cancel, ok := extractorCancels[requestID]
	if ok {
		delete(extractorCancels, requestID)
		extractorCanceled[requestID] = struct{}{}
	}
	extractorRequestsMu.Unlock()

	if ok {
		cancel()
	}

	return ok
}

// KillAllExtractorProcesses kills all running extractor processes
// This is useful for cleanup when starting fresh or when user stops fetch
func KillAllExtractorProcesses() {
	cancelRegisteredExtractorRequests()
	shutdownExtractorWorkerPool()

	exeName := getExecutableName()

	var cmd *exec.Cmd
	if runtime.GOOS == "windows" {
		// Use taskkill on Windows
		cmd = exec.Command("taskkill", "/F", "/IM", exeName)
	} else {
		// Use pkill on Unix
		cmd = exec.Command("pkill", "-f", exeName)
	}

	hideWindow(cmd)
	cmd.CombinedOutput() // Ignore errors - it's okay if no processes found
}

const extractorWorkerPoolSize = 2

type extractorWorkerPayload struct {
	URL        string   `json:"url"`
	AuthToken  string   `json:"auth_token,omitempty"`
	Guest      bool     `json:"guest,omitempty"`
	Retweets   string   `json:"retweets,omitempty"`
	NoVideos   bool     `json:"no_videos,omitempty"`
	Size       string   `json:"size,omitempty"`
	Limit      int      `json:"limit,omitempty"`
	Metadata   bool     `json:"metadata,omitempty"`
	TextTweets bool     `json:"text_tweets,omitempty"`
	Type       string   `json:"type,omitempty"`
	Verbose    bool     `json:"verbose,omitempty"`
	Set        []string `json:"set,omitempty"`
	Cursor     string   `json:"cursor,omitempty"`
}

type extractorWorkerRequest struct {
	ID      string                 `json:"id"`
	Request extractorWorkerPayload `json:"request"`
}

type extractorWorkerResponse struct {
	ID     string          `json:"id"`
	OK     bool            `json:"ok"`
	Result json.RawMessage `json:"result,omitempty"`
	Error  string          `json:"error,omitempty"`
}

type extractorWorker struct {
	exePath string

	mu     sync.Mutex
	cmd    *exec.Cmd
	stdin  io.WriteCloser
	stdout *bufio.Reader
	dead   bool
}

type extractorWorkerPool struct {
	exePath string
	maxSize int

	available chan *extractorWorker

	mu           sync.Mutex
	active       int
	shuttingDown bool
}

func newExtractorWorker(exePath string) (*extractorWorker, error) {
	cmd := exec.Command(exePath, "--worker")
	cmd.Env = append(os.Environ(),
		"PYTHONIOENCODING=utf-8",
		"PYTHONUTF8=1",
	)
	hideWindow(cmd)

	stdin, err := cmd.StdinPipe()
	if err != nil {
		return nil, fmt.Errorf("failed to open worker stdin: %w", err)
	}

	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return nil, fmt.Errorf("failed to open worker stdout: %w", err)
	}

	stderr, err := cmd.StderrPipe()
	if err != nil {
		return nil, fmt.Errorf("failed to open worker stderr: %w", err)
	}

	if err := cmd.Start(); err != nil {
		return nil, fmt.Errorf("failed to start extractor worker: %w", err)
	}

	go func() {
		_, _ = io.Copy(io.Discard, stderr)
	}()

	return &extractorWorker{
		exePath: exePath,
		cmd:     cmd,
		stdin:   stdin,
		stdout:  bufio.NewReader(stdout),
	}, nil
}

func (w *extractorWorker) markDead() {
	w.mu.Lock()
	w.dead = true
	w.mu.Unlock()
}

func (w *extractorWorker) isDead() bool {
	w.mu.Lock()
	dead := w.dead
	w.mu.Unlock()
	return dead
}

func (w *extractorWorker) stop() {
	w.mu.Lock()
	if w.dead {
		w.mu.Unlock()
		return
	}
	w.dead = true
	cmd := w.cmd
	stdin := w.stdin
	w.mu.Unlock()

	if stdin != nil {
		_ = stdin.Close()
	}
	if cmd != nil && cmd.Process != nil {
		_ = cmd.Process.Kill()
	}
	if cmd != nil {
		_, _ = cmd.Process.Wait()
	}
}

func (w *extractorWorker) execute(requestID string, payload extractorWorkerPayload) ([]byte, error) {
	request := extractorWorkerRequest{
		ID:      requestID,
		Request: payload,
	}

	requestLine, err := json.Marshal(request)
	if err != nil {
		return nil, fmt.Errorf("%w: failed to encode worker request: %v", errExtractorWorker, err)
	}

	cleanup := registerExtractorRequest(requestID, func() {
		w.stop()
	})
	defer cleanup()

	w.mu.Lock()
	if w.dead || w.stdin == nil || w.stdout == nil {
		w.mu.Unlock()
		return nil, fmt.Errorf("%w: worker unavailable", errExtractorWorker)
	}
	stdin := w.stdin
	stdout := w.stdout
	w.mu.Unlock()

	requestLine = append(requestLine, '\n')
	if _, err := stdin.Write(requestLine); err != nil {
		w.markDead()
		if consumeExtractorRequestCanceled(requestID) {
			return nil, ErrExtractorCanceled
		}
		return nil, fmt.Errorf("%w: failed to write worker request: %v", errExtractorWorker, err)
	}

	responseLine, err := stdout.ReadBytes('\n')
	if err != nil {
		w.markDead()
		if consumeExtractorRequestCanceled(requestID) {
			return nil, ErrExtractorCanceled
		}
		return nil, fmt.Errorf("%w: failed to read worker response: %v", errExtractorWorker, err)
	}

	var response extractorWorkerResponse
	if err := json.Unmarshal(bytes.TrimSpace(responseLine), &response); err != nil {
		w.markDead()
		return nil, fmt.Errorf("%w: invalid worker response: %v", errExtractorWorker, err)
	}

	if response.ID != "" && response.ID != requestID {
		w.markDead()
		return nil, fmt.Errorf("%w: mismatched worker response id %q", errExtractorWorker, response.ID)
	}

	if !response.OK {
		if response.Error == "" {
			response.Error = "extractor worker returned an unknown error"
		}
		return nil, fmt.Errorf("%s", response.Error)
	}

	return response.Result, nil
}

func getExtractorWorkerPool(exePath string) *extractorWorkerPool {
	extractorPoolMu.Lock()
	defer extractorPoolMu.Unlock()

	if extractorPool == nil || extractorPool.exePath != exePath {
		if extractorPool != nil {
			extractorPool.shutdown()
		}
		extractorPool = &extractorWorkerPool{
			exePath:      exePath,
			maxSize:      extractorWorkerPoolSize,
			available:    make(chan *extractorWorker, extractorWorkerPoolSize),
			shuttingDown: false,
		}
	}

	return extractorPool
}

func shutdownExtractorWorkerPool() {
	extractorPoolMu.Lock()
	pool := extractorPool
	extractorPool = nil
	extractorPoolMu.Unlock()

	if pool != nil {
		pool.shutdown()
	}
}

func (p *extractorWorkerPool) acquire() (*extractorWorker, error) {
	for {
		select {
		case worker := <-p.available:
			if worker == nil || worker.isDead() {
				if worker != nil {
					worker.stop()
				}
				p.mu.Lock()
				if p.active > 0 {
					p.active--
				}
				p.mu.Unlock()
				continue
			}
			return worker, nil
		default:
		}

		p.mu.Lock()
		if p.shuttingDown {
			p.mu.Unlock()
			return nil, fmt.Errorf("%w: worker pool is shutting down", errExtractorWorker)
		}
		if p.active < p.maxSize {
			p.active++
			p.mu.Unlock()

			worker, err := newExtractorWorker(p.exePath)
			if err != nil {
				p.mu.Lock()
				if p.active > 0 {
					p.active--
				}
				p.mu.Unlock()
				return nil, fmt.Errorf("%w: %v", errExtractorWorker, err)
			}
			return worker, nil
		}
		p.mu.Unlock()

		worker := <-p.available
		if worker == nil {
			continue
		}
		if worker.isDead() {
			worker.stop()
			p.mu.Lock()
			if p.active > 0 {
				p.active--
			}
			p.mu.Unlock()
			continue
		}
		return worker, nil
	}
}

func (p *extractorWorkerPool) release(worker *extractorWorker) {
	if worker == nil {
		return
	}

	p.mu.Lock()
	shuttingDown := p.shuttingDown
	p.mu.Unlock()

	if shuttingDown || worker.isDead() {
		worker.stop()
		p.mu.Lock()
		if p.active > 0 {
			p.active--
		}
		p.mu.Unlock()
		return
	}

	p.available <- worker
}

func (p *extractorWorkerPool) shutdown() {
	p.mu.Lock()
	p.shuttingDown = true
	p.mu.Unlock()

	for {
		select {
		case worker := <-p.available:
			if worker != nil {
				worker.stop()
				p.mu.Lock()
				if p.active > 0 {
					p.active--
				}
				p.mu.Unlock()
			}
		default:
			return
		}
	}
}

// parseExtractorError parses the extractor output and returns a user-friendly error message
// while preserving the original error from gallery-dl
func parseExtractorError(output string, username string) string {
	outputLower := strings.ToLower(output)

	// Extract the actual error line from gallery-dl output
	lines := strings.Split(output, "\n")
	var errorLine string
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}

		lineLower := strings.ToLower(line)

		// Ignore noisy Python warnings so they don't mask the real failure reason.
		if strings.Contains(lineLower, "notopensslwarning") ||
			strings.Contains(lineLower, "urllib3 v2 only supports openssl") {
			continue
		}

		if strings.Contains(lineLower, "error:") || strings.Contains(lineLower, "exception") {
			errorLine = line
			break
		}
	}
	if errorLine == "" {
		filtered := make([]string, 0, len(lines))
		for _, line := range lines {
			line = strings.TrimSpace(line)
			if line == "" {
				continue
			}
			lineLower := strings.ToLower(line)
			if strings.Contains(lineLower, "notopensslwarning") ||
				strings.Contains(lineLower, "urllib3 v2 only supports openssl") {
				continue
			}
			filtered = append(filtered, line)
		}
		errorLine = strings.Join(filtered, " ")
	}
	if strings.TrimSpace(errorLine) == "" {
		errorLine = "extractor terminated before returning data"
	}

	// Truncate if too long
	if len(errorLine) > 300 {
		errorLine = errorLine[:300] + "..."
	}

	// Add context hint based on error type, but keep original message
	var hint string
	if strings.Contains(outputLower, "unable to retrieve tweets from this timeline") {
		hint = " [Hint: End of timeline reached or rate limited - data already fetched has been saved]"
	} else if strings.Contains(outputLower, "rate limit") || strings.Contains(output, "429") {
		hint = " [Hint: Wait 5-15 minutes before retrying]"
	} else if strings.Contains(output, "401") || strings.Contains(outputLower, "unauthorized") {
		hint = " [Hint: Auth token may be invalid or expired]"
	} else if strings.Contains(output, "404") {
		hint = fmt.Sprintf(" [Hint: @%s may not exist or is suspended]", username)
	} else if strings.Contains(outputLower, "protected") || strings.Contains(output, "403") {
		hint = " [Hint: Protected account - need to follow and use auth token]"
	}

	return errorLine + hint
}

// TweetIDString is a custom type that unmarshals int64 but marshals as string
type TweetIDString int64

// MarshalJSON converts TweetIDString to JSON string to preserve precision in JavaScript
func (t TweetIDString) MarshalJSON() ([]byte, error) {
	return []byte(fmt.Sprintf(`"%d"`, t)), nil
}

// UnmarshalJSON accepts both number and string from JSON
func (t *TweetIDString) UnmarshalJSON(data []byte) error {
	// Try to unmarshal as number first (from extractor)
	var num int64
	if err := json.Unmarshal(data, &num); err == nil {
		*t = TweetIDString(num)
		return nil
	}
	// Try as string (for future compatibility)
	var str string
	if err := json.Unmarshal(data, &str); err == nil {
		parsed, err := fmt.Sscanf(str, "%d", &num)
		if err != nil || parsed != 1 {
			return fmt.Errorf("invalid tweet_id string: %s", str)
		}
		*t = TweetIDString(num)
		return nil
	}
	return fmt.Errorf("tweet_id must be number or string")
}

// Author represents tweet author information from extractor
type Author struct {
	ID   int64  `json:"id"`
	Name string `json:"name"`
	Nick string `json:"nick"`
}

// UserInfo represents full user information from extractor
type UserInfo struct {
	ID              int64  `json:"id"`
	Name            string `json:"name"`
	Nick            string `json:"nick"`
	Location        string `json:"location"`
	Date            string `json:"date"`
	Verified        bool   `json:"verified"`
	Protected       bool   `json:"protected"`
	ProfileBanner   string `json:"profile_banner"`
	ProfileImage    string `json:"profile_image"`
	FavouritesCount int    `json:"favourites_count"`
	FollowersCount  int    `json:"followers_count"`
	FriendsCount    int    `json:"friends_count"`
	ListedCount     int    `json:"listed_count"`
	MediaCount      int    `json:"media_count"`
	StatusesCount   int    `json:"statuses_count"`
	Description     string `json:"description"`
	URL             string `json:"url"`
}

// CLIMediaItem represents a single media entry from extractor CLI
type CLIMediaItem struct {
	URL            string        `json:"url"`
	TweetID        TweetIDString `json:"tweet_id"`
	RetweetID      TweetIDString `json:"retweet_id"`
	QuoteID        TweetIDString `json:"quote_id"`
	ReplyID        TweetIDString `json:"reply_id"`
	ConversationID TweetIDString `json:"conversation_id"`
	Date           string        `json:"date"`
	Extension      string        `json:"extension"`
	Width          int           `json:"width"`
	Height         int           `json:"height"`
	Type           string        `json:"type"`
	Bitrate        int           `json:"bitrate"`
	Duration       float64       `json:"duration"`
	Author         UserInfo      `json:"author"`
	User           UserInfo      `json:"user"`
	Content        string        `json:"content"`
	FavoriteCount  int           `json:"favorite_count"`
	RetweetCount   int           `json:"retweet_count"`
	ReplyCount     int           `json:"reply_count"`
	QuoteCount     int           `json:"quote_count"`
	BookmarkCount  int           `json:"bookmark_count"`
	ViewCount      int           `json:"view_count"`
	Source         string        `json:"source"`
	Sensitive      bool          `json:"sensitive"`
}

// TweetMetadata represents tweet metadata from extractor
type TweetMetadata struct {
	TweetID        TweetIDString `json:"tweet_id"`
	RetweetID      TweetIDString `json:"retweet_id,omitempty"`
	QuoteID        TweetIDString `json:"quote_id,omitempty"`
	ReplyID        TweetIDString `json:"reply_id,omitempty"`
	ConversationID TweetIDString `json:"conversation_id,omitempty"`
	Date           string        `json:"date"`
	Author         Author        `json:"author"`
	Content        string        `json:"content"`
	Lang           string        `json:"lang,omitempty"`
	Hashtags       []string      `json:"hashtags,omitempty"`
	FavoriteCount  int           `json:"favorite_count"`
	RetweetCount   int           `json:"retweet_count"`
	QuoteCount     int           `json:"quote_count,omitempty"`
	ReplyCount     int           `json:"reply_count,omitempty"`
	BookmarkCount  int           `json:"bookmark_count,omitempty"`
	ViewCount      int           `json:"view_count,omitempty"`
	Sensitive      bool          `json:"sensitive,omitempty"`
}

// CLIResponse represents the raw response from extractor CLI
type CLIResponse struct {
	Media     []CLIMediaItem  `json:"media"`
	Metadata  []TweetMetadata `json:"metadata"`
	Cursor    string          `json:"cursor,omitempty"`    // Cursor for resume
	Total     int             `json:"total,omitempty"`     // Total items fetched
	Completed bool            `json:"completed,omitempty"` // True if all fetched
}

// TimelineEntry represents a single media entry for frontend (converted from MediaItem)
type TimelineEntry struct {
	URL              string        `json:"url"`
	Date             string        `json:"date"`
	TweetID          TweetIDString `json:"tweet_id"`
	Type             string        `json:"type"`
	IsRetweet        bool          `json:"is_retweet"`
	Extension        string        `json:"extension"`
	Width            int           `json:"width"`
	Height           int           `json:"height"`
	Content          string        `json:"content,omitempty"`
	ViewCount        int           `json:"view_count,omitempty"`
	BookmarkCount    int           `json:"bookmark_count,omitempty"`
	FavoriteCount    int           `json:"favorite_count,omitempty"`
	RetweetCount     int           `json:"retweet_count,omitempty"`
	ReplyCount       int           `json:"reply_count,omitempty"`
	Source           string        `json:"source,omitempty"`
	Verified         bool          `json:"verified,omitempty"`
	OriginalFilename string        `json:"original_filename,omitempty"` // Original filename from API
	AuthorUsername   string        `json:"author_username,omitempty"`   // Username of tweet author (for bookmarks and likes)
}

// AccountInfo represents Twitter account information (derived from metadata)
type AccountInfo struct {
	Name           string `json:"name"`
	Nick           string `json:"nick"`
	Date           string `json:"date"`
	FollowersCount int    `json:"followers_count"`
	FriendsCount   int    `json:"friends_count"`
	ProfileImage   string `json:"profile_image"`
	StatusesCount  int    `json:"statuses_count"`
}

// ExtractMetadata represents extraction metadata
type ExtractMetadata struct {
	NewEntries int    `json:"new_entries"`
	Page       int    `json:"page"`
	BatchSize  int    `json:"batch_size"`
	HasMore    bool   `json:"has_more"`
	Cursor     string `json:"cursor,omitempty"`    // Cursor for resume capability
	Completed  bool   `json:"completed,omitempty"` // True if all media fetched
}

// TwitterResponse represents the full response for frontend
type TwitterResponse struct {
	AccountInfo AccountInfo     `json:"account_info"`
	TotalURLs   int             `json:"total_urls"`
	Timeline    []TimelineEntry `json:"timeline"`
	Metadata    ExtractMetadata `json:"metadata"`
	Cursor      string          `json:"cursor,omitempty"`    // Cursor for next fetch
	Completed   bool            `json:"completed,omitempty"` // True if fetch completed
}

// TimelineRequest represents request parameters for timeline extraction
type TimelineRequest struct {
	Username     string `json:"username"`
	AuthToken    string `json:"auth_token"`
	TimelineType string `json:"timeline_type"` // media, timeline, tweets, with_replies, likes, bookmarks
	BatchSize    int    `json:"batch_size"`    // 0 = all
	Page         int    `json:"page"`
	MediaType    string `json:"media_type"` // all, image, video, gif
	Retweets     bool   `json:"retweets"`
	RequestID    string `json:"request_id,omitempty"`
	Cursor       string `json:"cursor,omitempty"` // Resume from this cursor position
}

// DateRangeRequest represents request parameters for date range extraction
type DateRangeRequest struct {
	Username    string `json:"username"`
	AuthToken   string `json:"auth_token"`
	StartDate   string `json:"start_date"` // YYYY-MM-DD
	EndDate     string `json:"end_date"`   // YYYY-MM-DD
	MediaFilter string `json:"media_filter"`
	Retweets    bool   `json:"retweets"`
	RequestID   string `json:"request_id,omitempty"`
}

// buildTwitterURL constructs the Twitter URL based on username and timeline type
func buildTwitterURL(username, timelineType string) string {
	// Special case: bookmarks don't need username
	if timelineType == "bookmarks" {
		return "https://x.com/i/bookmarks"
	}

	// Clean username - extract handle from URL if needed
	username = cleanUsername(username)

	// Build URL based on timeline type
	baseURL := "https://x.com/" + username
	switch timelineType {
	case "media":
		return baseURL + "/media"
	case "timeline":
		return baseURL + "/timeline" // Best for cursor support
	case "tweets":
		return baseURL + "/tweets"
	case "with_replies":
		return baseURL + "/with_replies"
	case "likes":
		return baseURL + "/likes"
	default:
		return baseURL + "/timeline" // Default to timeline for reliable cursor
	}
}

// cleanUsername extracts the handle from different input formats
// Handles: @username, username, https://x.com/username, https://x.com/username/media, etc.
func cleanUsername(username string) string {
	username = strings.TrimSpace(username)
	username = strings.TrimPrefix(username, "@")

	if strings.Contains(username, "x.com/") || strings.Contains(username, "twitter.com/") {
		parsed := username
		if !strings.HasPrefix(parsed, "http://") && !strings.HasPrefix(parsed, "https://") {
			parsed = "https://" + strings.TrimPrefix(parsed, "//")
		}
		if u, err := url.Parse(parsed); err == nil {
			segments := strings.Split(strings.Trim(u.Path, "/"), "/")
			// Skip special paths like /i/bookmarks, /search, /home, /explore
			if len(segments) > 0 && segments[0] != "" {
				firstSegment := strings.ToLower(segments[0])
				// These are not usernames
				if firstSegment == "i" || firstSegment == "search" || firstSegment == "home" || firstSegment == "explore" || firstSegment == "settings" || firstSegment == "messages" || firstSegment == "notifications" {
					return username // Return as-is, let caller handle
				}
				return segments[0]
			}
		}
	}

	return username
}

// ensureURLScheme normalises URLs so the CLI accepts them
func ensureURLScheme(raw string) string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return raw
	}
	if strings.HasPrefix(raw, "http://") || strings.HasPrefix(raw, "https://") {
		return raw
	}
	if strings.HasPrefix(raw, "//") {
		return "https:" + raw
	}
	return "https://" + strings.TrimPrefix(raw, "//")
}

// buildSearchURL assembles an X.com search URL for date range queries
func buildSearchURL(username, startDate, endDate, mediaFilter string, includeRetweets bool) string {
	trimmed := strings.TrimSpace(username)
	lower := strings.ToLower(trimmed)
	if strings.Contains(lower, "search?q=") {
		return ensureURLScheme(trimmed)
	}

	handle := cleanUsername(trimmed)
	var parts []string
	if handle != "" {
		parts = append(parts, fmt.Sprintf("from:%s", handle))
	}
	if startDate != "" {
		parts = append(parts, fmt.Sprintf("since:%s", startDate))
	}
	if endDate != "" {
		parts = append(parts, fmt.Sprintf("until:%s", endDate))
	}

	switch strings.ToLower(strings.TrimSpace(mediaFilter)) {
	case "image", "images", "photo", "photos":
		parts = append(parts, "filter:images")
	case "video", "videos", "gif", "gifs":
		parts = append(parts, "filter:videos")
	case "text":
		parts = append(parts, "-filter:media")
	default:
		parts = append(parts, "filter:media")
	}

	if !includeRetweets {
		parts = append(parts, "-filter:retweets")
	}

	query := url.QueryEscape(strings.Join(parts, " "))
	return fmt.Sprintf("https://x.com/search?q=%s&src=typed_query&f=live", query)
}

// convertMetadataToTimelineEntry converts metadata-only tweets to timeline entries
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

// getExtractorPath returns the path to extractor binary
// Binary is stored in ~/.twitterxmediabatchdownloader/ (same as ffmpeg and database)
func getExtractorPath() string {
	homeDir, _ := os.UserHomeDir()
	baseDir := filepath.Join(homeDir, ".twitterxmediabatchdownloader")
	return filepath.Join(baseDir, getExecutableName())
}

// getHashFilePath returns the path to the hash file for version checking
func getHashFilePath() string {
	homeDir, _ := os.UserHomeDir()
	baseDir := filepath.Join(homeDir, ".twitterxmediabatchdownloader")
	return filepath.Join(baseDir, "extractor.sha256")
}

// calculateHash calculates SHA256 hash of data
func calculateHash(data []byte) string {
	hash := sha256.Sum256(data)
	return hex.EncodeToString(hash[:])
}

// ensureExtractor ensures the extractor binary exists
// Extracts from embedded binary if not present or if hash differs (update)
func ensureExtractor() (string, error) {
	exePath := getExtractorPath()
	hashPath := getHashFilePath()
	baseDir := filepath.Dir(exePath)

	// Create directory if not exists
	if err := os.MkdirAll(baseDir, 0755); err != nil {
		return "", fmt.Errorf("failed to create directory: %v", err)
	}

	// Calculate hash of embedded binary
	embeddedHash := calculateHash(extractorBin)

	// Check if binary and hash file exist
	if _, err := os.Stat(exePath); err == nil {
		// Binary exists - check hash
		if storedHash, err := os.ReadFile(hashPath); err == nil {
			if string(storedHash) == embeddedHash {
				return exePath, nil // Already extracted and up to date
			}
		}
		// Hash differs or missing - need to update
		os.Remove(exePath)
	}

	// Extract binary
	if err := os.WriteFile(exePath, extractorBin, 0755); err != nil {
		return "", fmt.Errorf("failed to write extractor: %v", err)
	}

	// Save hash for future comparison
	if err := os.WriteFile(hashPath, []byte(embeddedHash), 0644); err != nil {
		// Non-fatal - binary still works, just won't skip next time
		fmt.Printf("Warning: failed to save hash file: %v\n", err)
	}

	return exePath, nil
}

func runExtractorCommand(exePath string, args []string, username string, requestID string) ([]byte, error) {
	ctx := context.Background()
	cleanup := func() {}
	if strings.TrimSpace(requestID) != "" {
		var cancel context.CancelFunc
		ctx, cancel = context.WithCancel(context.Background())
		cleanup = registerExtractorRequest(requestID, cancel)
	}
	defer cleanup()

	cmd := exec.CommandContext(ctx, exePath, args...)
	cmd.Env = append(os.Environ(),
		"PYTHONIOENCODING=utf-8",
		"PYTHONUTF8=1",
	)
	hideWindow(cmd)

	output, err := cmd.CombinedOutput()
	if err != nil {
		if errors.Is(ctx.Err(), context.Canceled) || consumeExtractorRequestCanceled(requestID) {
			return nil, ErrExtractorCanceled
		}

		outputStr := string(output)
		errorMsg := parseExtractorError(outputStr, username)
		return nil, fmt.Errorf("%s", errorMsg)
	}

	return output, nil
}

func executeExtractorRequest(
	exePath string,
	requestID string,
	payload extractorWorkerPayload,
	args []string,
	username string,
) ([]byte, error) {
	pool := getExtractorWorkerPool(exePath)
	if pool != nil {
		worker, err := pool.acquire()
		if err == nil {
			output, execErr := worker.execute(requestID, payload)
			pool.release(worker)
			if execErr == nil || errors.Is(execErr, ErrExtractorCanceled) || !errors.Is(execErr, errExtractorWorker) {
				return output, execErr
			}
		}
	}

	return runExtractorCommand(exePath, args, username, requestID)
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
func extractJSON(output string) string {
	trimmed := strings.TrimSpace(output)
	trimmed = strings.TrimPrefix(trimmed, "\ufeff")
	trimmed = strings.TrimSpace(trimmed)
	if trimmed == "" {
		return ""
	}

	// Fast path for the common case where stdout already contains only JSON.
	if json.Valid([]byte(trimmed)) {
		return trimmed
	}

	for i := 0; i < len(output); i++ {
		switch output[i] {
		case '{', '[':
			candidate, ok := decodeJSONValue(output[i:])
			if ok {
				return candidate
			}
		}
	}

	return ""
}

func decodeJSONValue(input string) (string, bool) {
	input = strings.TrimLeft(input, " \t\r\n")
	if input == "" {
		return "", false
	}

	decoder := json.NewDecoder(strings.NewReader(input))
	decoder.UseNumber()

	var raw json.RawMessage
	if err := decoder.Decode(&raw); err != nil || len(raw) == 0 {
		return "", false
	}

	return string(raw), true
}
