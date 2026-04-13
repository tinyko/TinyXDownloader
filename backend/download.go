package backend

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

const (
	// MaxConcurrentDownloads is the number of parallel downloads
	MaxConcurrentDownloads      = 10
	MaxConcurrentImageDownloads = 16
	MaxConcurrentVideoDownloads = 3
	partialDownloadSuffix       = ".part"
	downloadRequestTimeout      = 30 * time.Minute
	downloadConnectTimeout      = 15 * time.Second
	downloadResponseHeaderWait  = 30 * time.Second
	downloadRetryAttempts       = 3
)

// MediaItem represents a media item with metadata for download
type MediaItem struct {
	URL              string `json:"url"`
	Date             string `json:"date"`
	TweetID          int64  `json:"tweet_id"`
	Type             string `json:"type"`
	Username         string `json:"username"`
	Content          string `json:"content,omitempty"`           // Tweet text content (for text-only tweets)
	OriginalFilename string `json:"original_filename,omitempty"` // Original Twitter media filename (15 char alphanumeric)
}

// DownloadMediaFiles downloads media files from URLs to the output directory (legacy)
func DownloadMediaFiles(urls []string, outputDir string, customProxy string) (downloaded int, failed int, err error) {
	// Create output directory if it doesn't exist
	if err := os.MkdirAll(outputDir, 0755); err != nil {
		return 0, len(urls), fmt.Errorf("failed to create output directory: %v", err)
	}

	// Create HTTP client with proxy support
	client, err := createDownloadHTTPClient(customProxy)
	if err != nil {
		// If proxy setup fails, use default client without proxy
		client = defaultDownloadHTTPClient()
	}

	for _, mediaURL := range urls {
		filename := extractFilename(mediaURL)
		outputPath := filepath.Join(outputDir, filename)

		// Skip only if the existing file looks complete.
		shouldSkip, err := shouldSkipExistingFile(context.Background(), client, mediaURL, outputPath, "")
		if err == nil && shouldSkip {
			downloaded++
			continue
		}

		if err := downloadFileWithRetry(context.Background(), client, mediaURL, outputPath); err != nil {
			failed++
			continue
		}
		downloaded++
	}

	return downloaded, failed, nil
}

func defaultDownloadHTTPClient() *http.Client {
	transport := &http.Transport{
		DialContext: (&net.Dialer{
			Timeout:   downloadConnectTimeout,
			KeepAlive: 30 * time.Second,
		}).DialContext,
		ForceAttemptHTTP2:     true,
		MaxIdleConns:          100,
		MaxIdleConnsPerHost:   MaxConcurrentDownloads,
		IdleConnTimeout:       90 * time.Second,
		TLSHandshakeTimeout:   10 * time.Second,
		ExpectContinueTimeout: 1 * time.Second,
		ResponseHeaderTimeout: downloadResponseHeaderWait,
	}

	return &http.Client{
		Transport: transport,
		Timeout:   downloadRequestTimeout,
	}
}

func createDownloadHTTPClient(customProxy string) (*http.Client, error) {
	proxyURL, err := GetProxyURL(customProxy)
	if err != nil {
		return nil, err
	}

	client := defaultDownloadHTTPClient()
	if transport, ok := client.Transport.(*http.Transport); ok {
		transport.Proxy = http.ProxyURL(proxyURL)
	}

	return client, nil
}

func selectDownloadWorkerCount(tasks []downloadTask) int {
	if len(tasks) == 0 {
		return 0
	}

	videoLikeCount := 0
	for _, task := range tasks {
		if task.item.Type == "video" || task.item.Type == "gif" || task.item.Type == "animated_gif" {
			videoLikeCount++
		}
	}

	numWorkers := MaxConcurrentDownloads
	switch {
	case videoLikeCount == len(tasks):
		numWorkers = MaxConcurrentVideoDownloads
	case videoLikeCount == 0:
		numWorkers = MaxConcurrentImageDownloads
	default:
		numWorkers = MaxConcurrentDownloads
	}
	if numWorkers > len(tasks) {
		numWorkers = len(tasks)
	}

	return numWorkers
}

// ProgressCallback is a function type for progress updates
type ProgressCallback func(current, total int)

// ItemStatusCallback is a function type for per-item status updates
type ItemStatusCallback func(tweetID int64, index int, status string) // status: "success", "failed", "skipped"

// downloadTask represents a single download task
type downloadTask struct {
	item       MediaItem
	outputPath string
	index      int
}

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

// DownloadMediaWithMetadataProgressAndStatus downloads media files with progress and per-item status callbacks
// Returns: downloaded count, skipped count, failed count, error
func DownloadMediaWithMetadataProgressAndStatus(items []MediaItem, outputDir string, username string, progress ProgressCallback, itemStatus ItemStatusCallback, ctx context.Context, customProxy string) (downloaded int, skipped int, failed int, err error) {
	if ctx == nil {
		ctx = context.Background()
	}

	total := len(items)
	if total == 0 {
		return 0, 0, 0, nil
	}

	// Prepare all tasks first (sequential to handle tweet media count)
	// For bookmarks and likes, each item may have different username, so we track per username
	tweetMediaCount := make(map[string]map[int64]int) // username -> tweet_id -> count
	tasks := make([]downloadTask, 0, total)

	for i, item := range items {
		itemUsername := resolveDownloadUsername(item, username)
		if itemUsername == "" {
			continue
		}
		subfolder := mediaSubfolder(item.Type)

		// Create base directory for this username
		baseDir := filepath.Join(outputDir, itemUsername)
		if err := os.MkdirAll(baseDir, 0755); err != nil {
			continue
		}

		// Create type subfolder
		typeDir := filepath.Join(baseDir, subfolder)
		if err := os.MkdirAll(typeDir, 0755); err != nil {
			continue
		}

		mediaIndex := nextMediaIndex(tweetMediaCount, itemUsername, item.TweetID)
		filename := buildMediaFilename(item, itemUsername, mediaIndex)
		outputPath := filepath.Join(typeDir, filename)

		tasks = append(tasks, downloadTask{
			item:       item,
			outputPath: outputPath,
			index:      i,
		})
	}

	// Counters for parallel downloads
	var downloadedCount int64
	var skippedCount int64
	var failedCount int64
	var completedCount int64
	var lastReportedPercent int64 = -1

	reportProgress := func(completed int64) {
		if progress == nil {
			return
		}

		percent := int64(100)
		if total > 0 {
			percent = (completed * 100) / int64(total)
		}

		for {
			last := atomic.LoadInt64(&lastReportedPercent)
			if completed < int64(total) && percent <= last {
				return
			}
			if atomic.CompareAndSwapInt64(&lastReportedPercent, last, percent) {
				progress(int(completed), total)
				return
			}
		}
	}

	// Create worker pool
	taskChan := make(chan downloadTask, len(tasks))
	var wg sync.WaitGroup

	// Start workers
	numWorkers := selectDownloadWorkerCount(tasks)

	// Create HTTP client once for all workers (shared client is more efficient)
	var sharedClient *http.Client
	client, err := createDownloadHTTPClient(customProxy)
	if err != nil {
		// If proxy setup fails, use default client without proxy
		sharedClient = defaultDownloadHTTPClient()
	} else {
		sharedClient = client
	}

	for i := 0; i < numWorkers; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			client := sharedClient

			for task := range taskChan {
				// Check for cancellation
				select {
				case <-ctx.Done():
					return
				default:
				}

				var status string
				// Skip only if the existing file looks complete.
				if shouldSkip, err := shouldSkipExistingFile(ctx, client, task.item.URL, task.outputPath, task.item.Type); err == nil && shouldSkip {
					status = "skipped"
					// Emit status immediately for skipped files
					if itemStatus != nil {
						itemStatus(task.item.TweetID, task.index, status)
					}
					atomic.AddInt64(&skippedCount, 1)
					completed := atomic.AddInt64(&completedCount, 1)
					reportProgress(completed)
					continue
				} else if task.item.Type == "text" {
					// For text tweets, write content to file
					if err := os.WriteFile(task.outputPath, []byte(task.item.Content), 0644); err != nil {
						atomic.AddInt64(&failedCount, 1)
						status = "failed"
					} else {
						atomic.AddInt64(&downloadedCount, 1)
						status = "success"
					}
				} else if err := downloadFileWithRetry(ctx, client, task.item.URL, task.outputPath); err != nil {
					atomic.AddInt64(&failedCount, 1)
					status = "failed"
				} else {
					// Embed metadata after successful download
					tweetURL := fmt.Sprintf("https://x.com/i/status/%d", task.item.TweetID)
					// Always extract original filename from URL (simpler approach)
					originalFilename := ExtractOriginalFilename(task.item.URL)

					// For debugging: if original filename is still empty for video, it means it's not in the URL
					// This is acceptable - video URLs from Twitter may not contain original filename

					// Embed metadata (non-fatal: if it fails, file is still downloaded)
					if err := EmbedMetadata(task.outputPath, task.item.Content, tweetURL, originalFilename); err != nil {
						// Log error but don't fail the download
						// Metadata embedding is optional
					}

					atomic.AddInt64(&downloadedCount, 1)
					status = "success"
				}

				// Emit per-item status
				if itemStatus != nil {
					itemStatus(task.item.TweetID, task.index, status)
				}

				// Update progress
				completed := atomic.AddInt64(&completedCount, 1)
				reportProgress(completed)
			}
		}()
	}

	// Send tasks to workers
	for _, task := range tasks {
		select {
		case <-ctx.Done():
			close(taskChan)
			wg.Wait()
			return int(downloadedCount), int(skippedCount), int(failedCount) + (total - int(completedCount)), ctx.Err()
		case taskChan <- task:
		}
	}
	close(taskChan)

	// Wait for all workers to finish
	wg.Wait()

	return int(downloadedCount), int(skippedCount), int(failedCount), nil
}

func getPartialDownloadPath(outputPath string) string {
	return outputPath + partialDownloadSuffix
}

func cleanupFile(path string) {
	if path == "" {
		return
	}
	_ = os.Remove(path)
}

func shouldSkipExistingFile(ctx context.Context, client *http.Client, mediaURL, outputPath, mediaType string) (bool, error) {
	// Re-download attempts should be fast. We trust atomically finalized files here
	// and reserve slower remote validation for the explicit integrity checker.
	_ = ctx
	_ = client
	_ = mediaURL

	info, err := os.Stat(outputPath)
	if err != nil {
		if os.IsNotExist(err) {
			cleanupFile(getPartialDownloadPath(outputPath))
			return false, nil
		}
		return false, err
	}

	if info.IsDir() {
		return false, fmt.Errorf("output path is a directory: %s", outputPath)
	}

	if mediaType == "text" {
		cleanupFile(getPartialDownloadPath(outputPath))
		return true, nil
	}

	localSize := info.Size()
	if localSize <= 0 {
		cleanupFile(outputPath)
		cleanupFile(getPartialDownloadPath(outputPath))
		return false, nil
	}

	cleanupFile(getPartialDownloadPath(outputPath))
	return true, nil
}

func getRemoteFileSize(ctx context.Context, client *http.Client, mediaURL string) (int64, bool) {
	req, err := http.NewRequestWithContext(ctx, http.MethodHead, mediaURL, nil)
	if err == nil {
		resp, err := client.Do(req)
		if err == nil {
			defer resp.Body.Close()
			if resp.StatusCode == http.StatusOK && resp.ContentLength > 0 {
				return resp.ContentLength, true
			}
		}
	}

	req, err = http.NewRequestWithContext(ctx, http.MethodGet, mediaURL, nil)
	if err != nil {
		return 0, false
	}
	req.Header.Set("Range", "bytes=0-0")

	resp, err := client.Do(req)
	if err != nil {
		return 0, false
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusPartialContent {
		contentRange := resp.Header.Get("Content-Range")
		if total := parseContentRangeTotal(contentRange); total > 0 {
			return total, true
		}
	}

	if resp.ContentLength > 0 {
		return resp.ContentLength, true
	}

	return 0, false
}

func parseContentRangeTotal(contentRange string) int64 {
	parts := strings.Split(contentRange, "/")
	if len(parts) != 2 {
		return 0
	}

	total, err := strconv.ParseInt(parts[1], 10, 64)
	if err != nil || total <= 0 {
		return 0
	}

	return total
}

type downloadHTTPStatusError struct {
	StatusCode int
	Status     string
}

func (e *downloadHTTPStatusError) Error() string {
	return fmt.Sprintf("bad status: %s", e.Status)
}

func shouldRetryDownload(err error) bool {
	if err == nil {
		return false
	}

	if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
		return true
	}

	var statusErr *downloadHTTPStatusError
	if errors.As(err, &statusErr) {
		return statusErr.StatusCode == http.StatusRequestTimeout ||
			statusErr.StatusCode == http.StatusTooManyRequests ||
			statusErr.StatusCode == http.StatusBadGateway ||
			statusErr.StatusCode == http.StatusServiceUnavailable ||
			statusErr.StatusCode == http.StatusGatewayTimeout
	}

	var netErr net.Error
	if errors.As(err, &netErr) {
		return true
	}

	lower := strings.ToLower(err.Error())
	return strings.Contains(lower, "timeout") ||
		strings.Contains(lower, "connection reset") ||
		strings.Contains(lower, "broken pipe") ||
		strings.Contains(lower, "unexpected eof") ||
		strings.Contains(lower, "http2: stream closed")
}

func downloadFileWithRetry(ctx context.Context, client *http.Client, url, outputPath string) error {
	var lastErr error

	for attempt := 1; attempt <= downloadRetryAttempts; attempt++ {
		lastErr = downloadFileWithContext(ctx, client, url, outputPath)
		if lastErr == nil {
			return nil
		}

		if ctx.Err() != nil {
			return ctx.Err()
		}

		if !shouldRetryDownload(lastErr) || attempt == downloadRetryAttempts {
			return lastErr
		}

		time.Sleep(time.Duration(attempt) * time.Second)
	}

	return lastErr
}

// downloadFileWithContext downloads a single file with context support for cancellation
func downloadFileWithContext(ctx context.Context, client *http.Client, url, outputPath string) error {
	req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
	if err != nil {
		return err
	}

	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return &downloadHTTPStatusError{
			StatusCode: resp.StatusCode,
			Status:     resp.Status,
		}
	}

	tempPath := getPartialDownloadPath(outputPath)
	cleanupFile(tempPath)

	out, err := os.Create(tempPath)
	if err != nil {
		return err
	}
	defer func() {
		if out != nil {
			out.Close()
		}
		if err != nil || ctx.Err() != nil {
			cleanupFile(tempPath)
		}
	}()

	_, err = io.Copy(out, resp.Body)
	if err != nil {
		return err
	}

	if closeErr := out.Close(); closeErr != nil {
		err = closeErr
		return err
	}
	out = nil

	if err := os.Rename(tempPath, outputPath); err != nil {
		cleanupFile(tempPath)
		return err
	}

	return nil
}

// formatTimestamp converts date string to timestamp format
func formatTimestamp(dateStr string) string {
	// Try parsing various date formats
	formats := []string{
		"2006-01-02T15:04:05",       // ISO 8601 without timezone (from extractor)
		"2006-01-02T15:04:05+00:00", // ISO 8601 with timezone
		"2006-01-02T15:04:05-07:00", // ISO 8601 with timezone offset
		time.RFC3339,                // Standard RFC3339
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

	// Fallback: use empty string to indicate parsing failed
	return "00000000_000000"
}

// getExtension determines file extension from URL and type
func getExtension(mediaURL string, mediaType string) string {
	parsedURL, err := url.Parse(mediaURL)
	if err != nil {
		return ".jpg"
	}

	// Check format query param for Twitter images
	if format := parsedURL.Query().Get("format"); format != "" {
		return "." + format
	}

	// Get extension from path
	path := parsedURL.Path
	ext := filepath.Ext(path)
	if ext != "" {
		return ext
	}

	// Default based on type
	switch mediaType {
	case "video":
		return ".mp4"
	case "gif", "animated_gif":
		return ".mp4" // Twitter GIFs are actually MP4
	case "text":
		return ".txt"
	default:
		return ".jpg"
	}
}

// extractFilename extracts filename from URL (legacy)
func extractFilename(mediaURL string) string {
	parsedURL, err := url.Parse(mediaURL)
	if err != nil {
		return fmt.Sprintf("media_%d", time.Now().UnixNano())
	}

	// Get the path part
	path := parsedURL.Path

	// Extract base filename
	base := filepath.Base(path)

	// Handle Twitter image URLs: /media/XXX -> XXX.jpg
	if strings.Contains(mediaURL, "pbs.twimg.com/media/") {
		// Get format from query params
		format := parsedURL.Query().Get("format")
		if format == "" {
			format = "jpg"
		}

		// Remove any existing extension
		if idx := strings.LastIndex(base, "."); idx > 0 {
			base = base[:idx]
		}

		return base + "." + format
	}

	// Handle Twitter video URLs
	if strings.Contains(mediaURL, "video.twimg.com") {
		return base
	}

	// Default: use base name or generate one
	if base == "" || base == "." {
		return fmt.Sprintf("media_%d", time.Now().UnixNano())
	}

	return base
}

// downloadFile downloads a single file from URL
func downloadFile(client *http.Client, url, outputPath string) error {
	resp, err := client.Get(url)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("bad status: %s", resp.Status)
	}

	tempPath := getPartialDownloadPath(outputPath)
	cleanupFile(tempPath)

	out, err := os.Create(tempPath)
	if err != nil {
		return err
	}
	defer func() {
		if out != nil {
			out.Close()
		}
		if err != nil {
			cleanupFile(tempPath)
		}
	}()

	_, err = io.Copy(out, resp.Body)
	if err != nil {
		return err
	}

	if closeErr := out.Close(); closeErr != nil {
		err = closeErr
		return err
	}
	out = nil

	if err := os.Rename(tempPath, outputPath); err != nil {
		cleanupFile(tempPath)
		return err
	}

	return nil
}
