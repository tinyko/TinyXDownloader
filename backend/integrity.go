package backend

import (
	"context"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

const integrityCheckWorkers = 5

type DownloadIntegrityIssue struct {
	Path         string `json:"path"`
	RelativePath string `json:"relative_path"`
	Reason       string `json:"reason"`
	LocalSize    int64  `json:"local_size"`
	RemoteSize   int64  `json:"remote_size"`
	URL          string `json:"url,omitempty"`
}

type DownloadIntegrityReport struct {
	DownloadPath      string                   `json:"download_path"`
	ScannedFiles      int                      `json:"scanned_files"`
	CheckedFiles      int                      `json:"checked_files"`
	CompleteFiles     int                      `json:"complete_files"`
	PartialFiles      int                      `json:"partial_files"`
	IncompleteFiles   int                      `json:"incomplete_files"`
	UntrackedFiles    int                      `json:"untracked_files"`
	UnverifiableFiles int                      `json:"unverifiable_files"`
	Issues            []DownloadIntegrityIssue `json:"issues"`
}

type trackedLocalFile struct {
	path         string
	relativePath string
	item         MediaItem
}

type trackedFileCheckResult struct {
	complete     bool
	incomplete   bool
	unverifiable bool
	issue        *DownloadIntegrityIssue
}

// CheckDownloadIntegrity scans the download directory for partial and truncated files.
// It validates files that can be matched back to saved media entries in the database.
func CheckDownloadIntegrity(downloadPath, customProxy string) (DownloadIntegrityReport, error) {
	if db == nil {
		if err := InitDB(); err != nil {
			return DownloadIntegrityReport{}, err
		}
	}

	if strings.TrimSpace(downloadPath) == "" {
		downloadPath = GetDefaultDownloadPath()
	}

	absolutePath, err := filepath.Abs(downloadPath)
	if err != nil {
		return DownloadIntegrityReport{}, fmt.Errorf("failed to resolve download path: %w", err)
	}

	info, err := os.Stat(absolutePath)
	if err != nil {
		if os.IsNotExist(err) {
			return DownloadIntegrityReport{}, fmt.Errorf("download path does not exist: %s", absolutePath)
		}
		return DownloadIntegrityReport{}, fmt.Errorf("failed to access download path: %w", err)
	}
	if !info.IsDir() {
		return DownloadIntegrityReport{}, fmt.Errorf("download path is not a directory: %s", absolutePath)
	}

	trackedFiles, err := loadTrackedMediaIndex(absolutePath)
	if err != nil {
		return DownloadIntegrityReport{}, err
	}

	client, err := CreateHTTPClient(customProxy, 30*time.Second)
	if err != nil {
		client = &http.Client{Timeout: 30 * time.Second}
	}

	return checkDownloadDirectoryIntegrity(context.Background(), absolutePath, trackedFiles, client)
}

func loadTrackedMediaIndex(downloadPath string) (map[string]MediaItem, error) {
	rows, err := db.Query(`
		SELECT id, username, name, profile_image, COALESCE(account_info_json, ''), total_media, last_fetched,
		       COALESCE(response_json, ''), COALESCE(media_type, 'all'), COALESCE(timeline_type, 'timeline'),
		       COALESCE(retweets, 0), COALESCE(query_key, ''), COALESCE(cursor, ''),
		       COALESCE(completed, 1), COALESCE(followers_count, 0), COALESCE(statuses_count, 0),
		       fetch_key, COALESCE(storage_version, 1)
		FROM accounts
		ORDER BY last_fetched DESC
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	tracked := make(map[string]MediaItem)
	for rows.Next() {
		var summary accountSummaryRecord
		var lastFetched time.Time
		var retweetsInt int
		var completedInt int
		if err := rows.Scan(
			&summary.ID,
			&summary.Username,
			&summary.Name,
			&summary.ProfileImage,
			&summary.AccountInfoJSON,
			&summary.TotalMedia,
			&lastFetched,
			&summary.ResponseJSON,
			&summary.MediaType,
			&summary.TimelineType,
			&retweetsInt,
			&summary.QueryKey,
			&summary.Cursor,
			&completedInt,
			&summary.FollowersCount,
			&summary.StatusesCount,
			&summary.FetchKey,
			&summary.StorageVersion,
		); err != nil {
			continue
		}
		summary.LastFetched = lastFetched
		summary.Retweets = retweetsInt == 1
		summary.Completed = completedInt == 1

		if err := ensureScopeDownloadMediaIndex(&summary); err != nil {
			continue
		}
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	indexRows, err := db.Query(`
		SELECT relative_path, url, tweet_id, media_type, download_username
		FROM download_media_index
	`)
	if err != nil {
		return nil, err
	}
	defer indexRows.Close()

	for indexRows.Next() {
		var relativePath string
		var mediaURL string
		var tweetIDValue string
		var mediaType string
		var downloadUsername string
		if err := indexRows.Scan(&relativePath, &mediaURL, &tweetIDValue, &mediaType, &downloadUsername); err != nil {
			return nil, err
		}
		tweetID, _ := strconv.ParseInt(strings.TrimSpace(tweetIDValue), 10, 64)
		outputPath := filepath.Join(downloadPath, relativePath)
		tracked[filepath.Clean(outputPath)] = MediaItem{
			URL:      mediaURL,
			TweetID:  tweetID,
			Type:     mediaType,
			Username: downloadUsername,
		}
	}

	return tracked, indexRows.Err()
}

func checkDownloadDirectoryIntegrity(ctx context.Context, downloadPath string, tracked map[string]MediaItem, client *http.Client) (DownloadIntegrityReport, error) {
	report := DownloadIntegrityReport{
		DownloadPath: downloadPath,
		Issues:       make([]DownloadIntegrityIssue, 0),
	}

	trackedLocalFiles := make([]trackedLocalFile, 0)
	err := filepath.Walk(downloadPath, func(path string, info os.FileInfo, walkErr error) error {
		if walkErr != nil {
			return nil
		}
		if info.IsDir() {
			return nil
		}

		report.ScannedFiles++
		cleanPath := filepath.Clean(path)
		relativePath, err := filepath.Rel(downloadPath, cleanPath)
		if err != nil {
			relativePath = cleanPath
		}

		if strings.HasSuffix(strings.ToLower(info.Name()), partialDownloadSuffix) {
			report.CheckedFiles++
			report.PartialFiles++
			report.Issues = append(report.Issues, DownloadIntegrityIssue{
				Path:         cleanPath,
				RelativePath: relativePath,
				Reason:       "partial_file",
				LocalSize:    info.Size(),
			})
			return nil
		}

		item, ok := tracked[cleanPath]
		if !ok {
			report.UntrackedFiles++
			return nil
		}

		report.CheckedFiles++
		trackedLocalFiles = append(trackedLocalFiles, trackedLocalFile{
			path:         cleanPath,
			relativePath: relativePath,
			item:         item,
		})
		return nil
	})
	if err != nil {
		return report, err
	}

	if len(trackedLocalFiles) == 0 {
		sortIssues(report.Issues)
		return report, nil
	}

	jobs := make(chan trackedLocalFile)
	results := make(chan trackedFileCheckResult, len(trackedLocalFiles))
	var wg sync.WaitGroup

	workers := integrityCheckWorkers
	if workers > len(trackedLocalFiles) {
		workers = len(trackedLocalFiles)
	}

	for i := 0; i < workers; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for job := range jobs {
				results <- inspectTrackedFile(ctx, client, job)
			}
		}()
	}

	for _, file := range trackedLocalFiles {
		jobs <- file
	}
	close(jobs)

	wg.Wait()
	close(results)

	for result := range results {
		switch {
		case result.complete:
			report.CompleteFiles++
		case result.incomplete:
			report.IncompleteFiles++
			if result.issue != nil {
				report.Issues = append(report.Issues, *result.issue)
			}
		case result.unverifiable:
			report.UnverifiableFiles++
		}
	}

	sortIssues(report.Issues)
	return report, nil
}

func inspectTrackedFile(ctx context.Context, client *http.Client, file trackedLocalFile) trackedFileCheckResult {
	info, err := os.Stat(file.path)
	if err != nil {
		return trackedFileCheckResult{unverifiable: true}
	}

	if file.item.Type == "text" {
		if info.Size() > 0 {
			return trackedFileCheckResult{complete: true}
		}
		return trackedFileCheckResult{
			incomplete: true,
			issue: &DownloadIntegrityIssue{
				Path:         file.path,
				RelativePath: file.relativePath,
				Reason:       "empty_text_file",
				LocalSize:    info.Size(),
				URL:          file.item.URL,
			},
		}
	}

	if info.Size() <= 0 {
		return trackedFileCheckResult{
			incomplete: true,
			issue: &DownloadIntegrityIssue{
				Path:         file.path,
				RelativePath: file.relativePath,
				Reason:       "empty_file",
				LocalSize:    info.Size(),
				URL:          file.item.URL,
			},
		}
	}

	remoteSize, ok := getRemoteFileSize(ctx, client, file.item.URL)
	if !ok {
		return trackedFileCheckResult{unverifiable: true}
	}

	if info.Size() >= remoteSize {
		return trackedFileCheckResult{complete: true}
	}

	return trackedFileCheckResult{
		incomplete: true,
		issue: &DownloadIntegrityIssue{
			Path:         file.path,
			RelativePath: file.relativePath,
			Reason:       "size_mismatch",
			LocalSize:    info.Size(),
			RemoteSize:   remoteSize,
			URL:          file.item.URL,
		},
	}
}

func sortIssues(issues []DownloadIntegrityIssue) {
	sort.Slice(issues, func(i, j int) bool {
		return issues[i].RelativePath < issues[j].RelativePath
	})
}
