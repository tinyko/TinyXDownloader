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

const (
	downloadIntegrityModeQuick = "quick"
	downloadIntegrityModeDeep  = "deep"
)

type DownloadIntegrityIssue struct {
	Path         string `json:"path"`
	RelativePath string `json:"relative_path"`
	Reason       string `json:"reason"`
	LocalSize    int64  `json:"local_size"`
	RemoteSize   int64  `json:"remote_size"`
	URL          string `json:"url,omitempty"`
}

type DownloadIntegrityReport struct {
	Mode              string                   `json:"mode"`
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

type DownloadIntegrityProgress struct {
	Mode              string `json:"mode"`
	Phase             string `json:"phase"`
	ScannedFiles      int    `json:"scanned_files"`
	CheckedFiles      int    `json:"checked_files"`
	VerifiedFiles     int    `json:"verified_files"`
	CompleteFiles     int    `json:"complete_files"`
	PartialFiles      int    `json:"partial_files"`
	IncompleteFiles   int    `json:"incomplete_files"`
	UntrackedFiles    int    `json:"untracked_files"`
	UnverifiableFiles int    `json:"unverifiable_files"`
	IssuesCount       int    `json:"issues_count"`
}

type trackedLocalFile struct {
	path         string
	relativePath string
	item         MediaItem
}

type trackedFileCheckResult struct {
	verified     bool
	complete     bool
	incomplete   bool
	unverifiable bool
	issue        *DownloadIntegrityIssue
}

// CheckDownloadIntegrity scans the download directory for partial and truncated files.
// It validates files that can be matched back to saved media entries in the database.
func normalizeDownloadIntegrityMode(mode string) string {
	switch strings.TrimSpace(strings.ToLower(mode)) {
	case downloadIntegrityModeDeep:
		return downloadIntegrityModeDeep
	case downloadIntegrityModeQuick, "":
		fallthrough
	default:
		return downloadIntegrityModeQuick
	}
}

func NormalizeDownloadIntegrityModeForApp(mode string) string {
	return normalizeDownloadIntegrityMode(mode)
}

func CheckDownloadIntegrity(downloadPath, customProxy, mode string) (DownloadIntegrityReport, error) {
	return CheckDownloadIntegrityWithContext(context.Background(), downloadPath, customProxy, mode, nil)
}

func CheckDownloadIntegrityWithContext(
	ctx context.Context,
	downloadPath,
	customProxy,
	mode string,
	progressCallback func(DownloadIntegrityProgress),
) (DownloadIntegrityReport, error) {
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

	normalizedMode := normalizeDownloadIntegrityMode(mode)

	if progressCallback != nil {
		progressCallback(DownloadIntegrityProgress{
			Mode:  normalizedMode,
			Phase: "preparing-index",
		})
	}

	trackedFiles, err := loadTrackedMediaIndex(absolutePath)
	if err != nil {
		return DownloadIntegrityReport{}, err
	}

	var client *http.Client
	if normalizedMode == downloadIntegrityModeDeep {
		client, err = CreateHTTPClient(customProxy, 30*time.Second)
		if err != nil {
			client = &http.Client{Timeout: 30 * time.Second}
		}
	}

	return checkDownloadDirectoryIntegrity(
		ctx,
		absolutePath,
		trackedFiles,
		client,
		normalizedMode,
		progressCallback,
	)
}

func checkDownloadDirectoryIntegrity(
	ctx context.Context,
	downloadPath string,
	tracked map[string]MediaItem,
	client *http.Client,
	mode string,
	progressCallback func(DownloadIntegrityProgress),
) (DownloadIntegrityReport, error) {
	report := DownloadIntegrityReport{
		Mode:         mode,
		DownloadPath: downloadPath,
		Issues:       make([]DownloadIntegrityIssue, 0),
	}

	trackedLocalFiles := make([]trackedLocalFile, 0)
	seenTrackedPaths := make(map[string]struct{}, len(tracked))
	err := filepath.Walk(downloadPath, func(path string, info os.FileInfo, walkErr error) error {
		if ctx.Err() != nil {
			return ctx.Err()
		}
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
		seenTrackedPaths[cleanPath] = struct{}{}
		trackedLocalFiles = append(trackedLocalFiles, trackedLocalFile{
			path:         cleanPath,
			relativePath: relativePath,
			item:         item,
		})
		return nil
	})
	if err != nil {
		if ctx.Err() != nil {
			return report, ctx.Err()
		}
		return report, err
	}

	if progressCallback != nil {
		progressCallback(DownloadIntegrityProgress{
			Mode:              mode,
			Phase:             "scanning-local",
			ScannedFiles:      report.ScannedFiles,
			CheckedFiles:      report.CheckedFiles,
			CompleteFiles:     report.CompleteFiles,
			PartialFiles:      report.PartialFiles,
			IncompleteFiles:   report.IncompleteFiles,
			UntrackedFiles:    report.UntrackedFiles,
			UnverifiableFiles: report.UnverifiableFiles,
			IssuesCount:       len(report.Issues),
		})
	}

	for trackedPath, item := range tracked {
		if _, seen := seenTrackedPaths[trackedPath]; seen {
			continue
		}
		relativePath, err := filepath.Rel(downloadPath, trackedPath)
		if err != nil {
			relativePath = trackedPath
		}
		report.CheckedFiles++
		report.IncompleteFiles++
		report.Issues = append(report.Issues, DownloadIntegrityIssue{
			Path:         trackedPath,
			RelativePath: relativePath,
			Reason:       "missing_file",
			LocalSize:    0,
			URL:          item.URL,
		})
	}

	if mode == downloadIntegrityModeDeep && progressCallback != nil {
		progressCallback(DownloadIntegrityProgress{
			Mode:              mode,
			Phase:             "verifying-remote",
			ScannedFiles:      report.ScannedFiles,
			CheckedFiles:      report.CheckedFiles,
			CompleteFiles:     report.CompleteFiles,
			PartialFiles:      report.PartialFiles,
			IncompleteFiles:   report.IncompleteFiles,
			UntrackedFiles:    report.UntrackedFiles,
			UnverifiableFiles: report.UnverifiableFiles,
			IssuesCount:       len(report.Issues),
		})
	}

	if len(trackedLocalFiles) == 0 {
		sortIssues(report.Issues)
		if progressCallback != nil {
			progressCallback(DownloadIntegrityProgress{
				Mode:              mode,
				Phase:             "completed",
				ScannedFiles:      report.ScannedFiles,
				CheckedFiles:      report.CheckedFiles,
				CompleteFiles:     report.CompleteFiles,
				PartialFiles:      report.PartialFiles,
				IncompleteFiles:   report.IncompleteFiles,
				UntrackedFiles:    report.UntrackedFiles,
				UnverifiableFiles: report.UnverifiableFiles,
				IssuesCount:       len(report.Issues),
			})
		}
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
				results <- inspectTrackedFile(ctx, client, job, mode)
			}
		}()
	}

	for _, file := range trackedLocalFiles {
		jobs <- file
	}
	close(jobs)

	wg.Wait()
	close(results)

	verifiedFiles := 0
	for result := range results {
		if ctx.Err() != nil {
			return report, ctx.Err()
		}
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
		if result.verified {
			verifiedFiles++
		}
	}

	sortIssues(report.Issues)
	if progressCallback != nil {
		progressCallback(DownloadIntegrityProgress{
			Mode:              mode,
			Phase:             "completed",
			ScannedFiles:      report.ScannedFiles,
			CheckedFiles:      report.CheckedFiles,
			VerifiedFiles:     verifiedFiles,
			CompleteFiles:     report.CompleteFiles,
			PartialFiles:      report.PartialFiles,
			IncompleteFiles:   report.IncompleteFiles,
			UntrackedFiles:    report.UntrackedFiles,
			UnverifiableFiles: report.UnverifiableFiles,
			IssuesCount:       len(report.Issues),
		})
	}
	return report, nil
}

func inspectTrackedFile(
	ctx context.Context,
	client *http.Client,
	file trackedLocalFile,
	mode string,
) trackedFileCheckResult {
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

	if mode == downloadIntegrityModeQuick {
		return trackedFileCheckResult{complete: true}
	}

	remoteSize, ok := getRemoteFileSize(ctx, client, file.item.URL)
	if !ok {
		return trackedFileCheckResult{unverifiable: true}
	}

	if info.Size() >= remoteSize {
		return trackedFileCheckResult{verified: true, complete: true}
	}

	return trackedFileCheckResult{
		verified:   true,
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
