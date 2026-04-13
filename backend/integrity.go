package backend

import (
	"context"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"sort"
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
		SELECT username, COALESCE(media_type, 'all'), COALESCE(timeline_type, 'timeline'),
		       COALESCE(retweets, 0), COALESCE(query_key, '')
		FROM accounts
		ORDER BY last_fetched DESC
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	tracked := make(map[string]MediaItem)
	for rows.Next() {
		var scope FetchScopeRecord
		var retweetsInt int
		if err := rows.Scan(&scope.Username, &scope.MediaType, &scope.TimelineType, &retweetsInt, &scope.QueryKey); err != nil {
			continue
		}
		scope.Retweets = retweetsInt == 1

		payload, err := LoadScopeMediaDownloadPayload(scope)
		if err != nil || payload == nil || len(payload.Items) == 0 {
			continue
		}

		tweetMediaCount := make(map[string]map[int64]int)
		baseDir := downloadPath
		if payload.RootSubdirectory != "" {
			baseDir = filepath.Join(baseDir, payload.RootSubdirectory)
		}
		for _, item := range payload.Items {
			itemUsername := resolveDownloadUsername(item, payload.Username)
			if itemUsername == "" {
				continue
			}

			mediaIndex := nextMediaIndex(tweetMediaCount, itemUsername, item.TweetID)
			filename := buildMediaFilename(item, itemUsername, mediaIndex)
			outputPath := filepath.Join(baseDir, itemUsername, mediaSubfolder(item.Type), filename)
			tracked[filepath.Clean(outputPath)] = item
		}
	}

	return tracked, rows.Err()
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
