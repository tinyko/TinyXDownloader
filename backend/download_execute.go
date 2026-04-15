package backend

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"sync/atomic"
)

// DownloadMediaFiles downloads media files from URLs to the output directory (legacy).
func DownloadMediaFiles(urls []string, outputDir string, customProxy string) (downloaded int, failed int, err error) {
	if err := os.MkdirAll(outputDir, 0o755); err != nil {
		return 0, len(urls), fmt.Errorf("failed to create output directory: %v", err)
	}

	client, err := createDownloadHTTPClient(customProxy)
	if err != nil {
		client = defaultDownloadHTTPClient()
	}

	for _, mediaURL := range urls {
		filename := extractFilename(mediaURL)
		outputPath := filepath.Join(outputDir, filename)

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

// DownloadMediaWithMetadataProgressAndStatus downloads media files with progress and per-item status callbacks.
func DownloadMediaWithMetadataProgressAndStatus(
	items []MediaItem,
	outputDir string,
	username string,
	progress ProgressCallback,
	itemStatus ItemStatusCallback,
	ctx context.Context,
	customProxy string,
) (downloaded int, skipped int, failed int, err error) {
	if ctx == nil {
		ctx = context.Background()
	}

	total := len(items)
	if total == 0 {
		return 0, 0, 0, nil
	}

	tasks := buildDownloadTasks(items, outputDir, username, 0, make(map[string]struct{}))
	return executeDownloadTasks(tasks, total, progress, itemStatus, ctx, customProxy)
}

func DownloadScopePayloadsProgressAndStatus(
	payloads []*ScopeMediaDownloadPayload,
	outputDir string,
	progress ProgressCallback,
	itemStatus ItemStatusCallback,
	ctx context.Context,
	customProxy string,
) (downloaded int, skipped int, failed int, err error) {
	if ctx == nil {
		ctx = context.Background()
	}

	total := 0
	ensuredDirs := make(map[string]struct{})
	tasks := make([]downloadTask, 0)
	for _, payload := range payloads {
		if payload == nil || len(payload.Items) == 0 {
			continue
		}

		groupOutputDir := outputDir
		if payload.RootSubdirectory != "" {
			groupOutputDir = filepath.Join(groupOutputDir, payload.RootSubdirectory)
		}

		tasks = append(tasks, buildDownloadTasks(payload.Items, groupOutputDir, payload.Username, 0, ensuredDirs)...)
		total += len(payload.Items)
	}

	if total == 0 {
		return 0, 0, 0, nil
	}

	return executeDownloadTasks(tasks, total, progress, itemStatus, ctx, customProxy)
}

func executeDownloadTasks(
	tasks []downloadTask,
	reportedTotal int,
	progress ProgressCallback,
	itemStatus ItemStatusCallback,
	ctx context.Context,
	customProxy string,
) (downloaded int, skipped int, failed int, err error) {
	if ctx == nil {
		ctx = context.Background()
	}

	if reportedTotal <= 0 {
		reportedTotal = len(tasks)
	}
	if len(tasks) == 0 {
		return 0, 0, 0, nil
	}

	var downloadedCount int64
	var skippedCount int64
	var failedCount int64
	var completedCount int64
	var lastReportedPercent int64 = -1
	var callbackMu sync.Mutex

	reportProgress := func(completed int64) {
		if progress == nil {
			return
		}

		percent := int64(100)
		if reportedTotal > 0 {
			percent = (completed * 100) / int64(reportedTotal)
		}

		for {
			last := atomic.LoadInt64(&lastReportedPercent)
			if completed < int64(reportedTotal) && percent <= last {
				return
			}
			if atomic.CompareAndSwapInt64(&lastReportedPercent, last, percent) {
				callbackMu.Lock()
				progress(int(completed), reportedTotal)
				callbackMu.Unlock()
				return
			}
		}
	}

	taskChan := make(chan downloadTask, len(tasks))
	var wg sync.WaitGroup

	numWorkers := selectDownloadWorkerCount(tasks)

	sharedClient, clientErr := createDownloadHTTPClient(customProxy)
	if clientErr != nil {
		sharedClient = defaultDownloadHTTPClient()
	}

	for i := 0; i < numWorkers; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()

			for task := range taskChan {
				select {
				case <-ctx.Done():
					return
				default:
				}

				var status string
				if shouldSkip, err := shouldSkipExistingFile(ctx, sharedClient, task.item.URL, task.outputPath, task.item.Type); err == nil && shouldSkip {
					status = "skipped"
					if itemStatus != nil {
						callbackMu.Lock()
						itemStatus(task.item.TweetID, task.index, status)
						callbackMu.Unlock()
					}
					atomic.AddInt64(&skippedCount, 1)
					completed := atomic.AddInt64(&completedCount, 1)
					reportProgress(completed)
					continue
				} else if task.item.Type == "text" {
					if err := os.WriteFile(task.outputPath, []byte(task.item.Content), 0o644); err != nil {
						atomic.AddInt64(&failedCount, 1)
						status = "failed"
					} else {
						atomic.AddInt64(&downloadedCount, 1)
						status = "success"
					}
				} else if err := downloadFileWithRetry(ctx, sharedClient, task.item.URL, task.outputPath); err != nil {
					atomic.AddInt64(&failedCount, 1)
					status = "failed"
				} else {
					tweetURL := fmt.Sprintf("https://x.com/i/status/%d", task.item.TweetID)
					originalFilename := task.item.OriginalFilename
					if originalFilename == "" {
						originalFilename = ExtractOriginalFilename(task.item.URL)
					}
					if err := EmbedMetadata(task.outputPath, task.item.Content, tweetURL, originalFilename); err != nil {
					}

					atomic.AddInt64(&downloadedCount, 1)
					status = "success"
				}

				if itemStatus != nil {
					callbackMu.Lock()
					itemStatus(task.item.TweetID, task.index, status)
					callbackMu.Unlock()
				}

				completed := atomic.AddInt64(&completedCount, 1)
				reportProgress(completed)
			}
		}()
	}

	for _, task := range tasks {
		select {
		case <-ctx.Done():
			close(taskChan)
			wg.Wait()
			return int(downloadedCount), int(skippedCount), int(failedCount) + (reportedTotal - int(completedCount)), ctx.Err()
		case taskChan <- task:
		}
	}
	close(taskChan)

	wg.Wait()
	if progress != nil && reportedTotal > 0 {
		callbackMu.Lock()
		progress(int(completedCount), reportedTotal)
		callbackMu.Unlock()
	}
	return int(downloadedCount), int(skippedCount), int(failedCount), nil
}
