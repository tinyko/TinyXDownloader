package main

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"time"
	"twitterxmediabatchdownloader/backend"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

func (a *App) OpenFolder(path string) error {
	if path == "" {
		return fmt.Errorf("path is required")
	}

	cleanPath := filepath.Clean(path)
	if err := backend.OpenFolderInExplorer(cleanPath); err != nil {
		return fmt.Errorf("failed to open folder: %v", err)
	}
	return nil
}

func (a *App) SelectFolder(defaultPath string) (string, error) {
	return backend.SelectFolderDialog(a.ctx, defaultPath)
}

func (a *App) OpenAppDataFolder() error {
	return backend.OpenFolderInExplorer(backend.GetAppDataDir())
}

func (a *App) CreateDatabaseBackup() (string, error) {
	outputPath, err := openZipSaveDialog(
		a.ctx,
		"Create Database Backup",
		fmt.Sprintf("xdownloader-backup-%s.zip", timestampForFilename()),
	)
	if err != nil {
		return "", err
	}
	if outputPath == "" {
		return "", nil
	}

	if err := backend.CreateDatabaseBackup(outputPath, AppVersion()); err != nil {
		return "", err
	}
	return outputPath, nil
}

func (a *App) ExportSupportBundle() (string, error) {
	outputPath, err := openZipSaveDialog(
		a.ctx,
		"Export Support Bundle",
		fmt.Sprintf("xdownloader-support-%s.zip", timestampForFilename()),
	)
	if err != nil {
		return "", err
	}
	if outputPath == "" {
		return "", nil
	}

	a.downloadMu.Lock()
	downloadState := a.downloadState
	a.downloadMu.Unlock()

	a.integrityMu.Lock()
	integrityTask := a.integrityTask
	a.integrityMu.Unlock()

	if err := backend.ExportSupportBundle(outputPath, backend.SupportBundleOptions{
		AppName:    AppName(),
		AppVersion: AppVersion(),
		TaskSummary: backend.SupportBundleTaskSummary{
			Download: backend.SupportBundleDownloadSummary{
				Status:     map[bool]string{true: "running", false: "idle"}[downloadState.InProgress],
				InProgress: downloadState.InProgress,
				Current:    downloadState.Current,
				Total:      downloadState.Total,
				Percent:    downloadState.Percent,
			},
			Integrity: backend.SupportBundleIntegritySummary{
				Status:      integrityTask.Status,
				InProgress:  integrityTask.InProgress,
				Phase:       integrityTask.Phase,
				Mode:        integrityTask.Mode,
				IssuesCount: integrityTask.IssuesCount,
			},
		},
	}); err != nil {
		return "", err
	}

	return outputPath, nil
}

func (a *App) RestoreDatabaseBackup() (RestoreDatabaseBackupResponse, error) {
	inputPath, err := openZipOpenDialog(a.ctx, "Restore Database Backup")
	if err != nil {
		return RestoreDatabaseBackupResponse{
			Success: false,
			Message: err.Error(),
		}, err
	}
	if inputPath == "" {
		return RestoreDatabaseBackupResponse{
			Success:         false,
			RequiresRestart: false,
			Message:         "Cancelled",
		}, nil
	}

	if err := backend.RestoreDatabaseBackup(inputPath); err != nil {
		return RestoreDatabaseBackupResponse{
			Success: false,
			Message: err.Error(),
		}, err
	}

	return RestoreDatabaseBackupResponse{
		Success:         true,
		RequiresRestart: true,
		Message:         "Database backup restored. Restart the app to refresh open views.",
	}, nil
}

func (a *App) WriteDiagnosticLog(level, message string) {
	if err := backend.AppendDiagnosticLog(level, message); err != nil {
		_ = backend.AppendBackendDiagnosticLog("error", fmt.Sprintf("failed to persist frontend diagnostic log: %v", err))
	}
}

func (a *App) WriteSettingsSnapshot(raw string) {
	if err := backend.WriteSettingsSnapshot(raw); err != nil {
		_ = backend.AppendBackendDiagnosticLog("error", fmt.Sprintf("failed to persist settings snapshot: %v", err))
	}
}

func (a *App) WriteSmokeReport(payload string) error {
	return backend.WriteSmokeReport(payload)
}

func (a *App) GetExtractorMetricsSnapshot() backend.ExtractorMetricsSnapshot {
	return backend.GetExtractorMetricsSnapshot()
}

func (a *App) GetExtractorDiagnosticsSnapshot() backend.ExtractorDiagnosticsSnapshot {
	return backend.GetExtractorDiagnosticsSnapshot()
}

func (a *App) SaveExtractorRunbookConfig(config backend.ExtractorRunbookConfig) (backend.ExtractorRunbookConfig, error) {
	if a.smoke != nil {
		return backend.ExtractorRunbookConfig{}, fmt.Errorf("extractor runbook is unavailable in smoke mode")
	}
	return backend.SaveExtractorRunbookConfig(config)
}

func (a *App) SaveExtractorRolloutPolicy(policy backend.ExtractorRolloutPolicy) (backend.ExtractorRolloutPolicy, error) {
	if a.smoke != nil {
		return backend.ExtractorRolloutPolicy{}, fmt.Errorf("extractor rollout policy is unavailable in smoke mode")
	}
	return backend.SaveExtractorRolloutPolicy(policy)
}

func (a *App) RunExtractorValidationRunbook(req backend.ExtractorValidationRunRequest) (*backend.ExtractorValidationReport, error) {
	if a.smoke != nil {
		return nil, fmt.Errorf("extractor validation runbook is unavailable in smoke mode")
	}
	return backend.RunExtractorValidationRunbook(AppVersion(), req)
}

func (a *App) RunExtractorLiveValidationSession(req backend.ExtractorValidationRunRequest) (*backend.ExtractorLiveValidationReport, error) {
	if a.smoke != nil {
		return nil, fmt.Errorf("extractor live validation is unavailable in smoke mode")
	}
	return backend.RunExtractorLiveValidationSession(AppVersion(), req)
}

func (a *App) IsFFmpegInstalled() bool {
	return backend.IsFFmpegInstalled()
}

func (a *App) DownloadFFmpeg() error {
	return backend.DownloadFFmpeg(nil)
}

func (a *App) IsExifToolInstalled() bool {
	return backend.IsExifToolInstalled()
}

func (a *App) DownloadExifTool() error {
	return backend.DownloadExifTool(nil)
}

func (a *App) ConvertGIFs(req ConvertGIFsRequest) (ConvertGIFsResponse, error) {
	if !backend.IsFFmpegInstalled() {
		return ConvertGIFsResponse{
			Success: false,
			Message: "FFmpeg not installed. Please download it first.",
		}, nil
	}

	quality := req.Quality
	if quality == "" {
		quality = "fast"
	}
	resolution := req.Resolution
	if resolution == "" {
		resolution = "high"
	}

	converted, failed, err := backend.ConvertGIFsInFolder(
		req.FolderPath,
		quality,
		resolution,
		req.DeleteOriginal,
	)
	if err != nil {
		return ConvertGIFsResponse{Success: false, Message: err.Error()}, err
	}

	return ConvertGIFsResponse{
		Success:   true,
		Converted: converted,
		Failed:    failed,
		Message:   fmt.Sprintf("Converted %d GIFs, %d failed", converted, failed),
	}, nil
}

func (a *App) GetStoredAuthTokens() (StoredAuthTokensResponse, error) {
	tokens, err := backend.LoadStoredAuthTokens()
	if err != nil {
		return StoredAuthTokensResponse{}, err
	}
	return StoredAuthTokensResponse{
		PublicToken:  tokens.PublicToken,
		PrivateToken: tokens.PrivateToken,
	}, nil
}

func (a *App) SaveStoredAuthTokens(tokens StoredAuthTokensResponse) error {
	return backend.SaveStoredAuthTokens(backend.StoredAuthTokens{
		PublicToken:  tokens.PublicToken,
		PrivateToken: tokens.PrivateToken,
	})
}

func (a *App) CheckFolderExists(basePath, username string) bool {
	return backend.CheckFolderExists(basePath, username)
}

func (a *App) CheckFoldersExist(basePath string, folderNames []string) map[string]bool {
	return backend.CheckFoldersExist(basePath, folderNames)
}

func (a *App) GetDownloadDirectorySnapshot(basePath string) ([]string, error) {
	return backend.GetDownloadDirectorySnapshot(basePath)
}

func (a *App) CheckGifsFolderExists(basePath, username string) bool {
	return backend.CheckGifsFolderExists(basePath, username)
}

func (a *App) CheckGifsFolderHasMP4(basePath, username string) bool {
	return backend.CheckGifsFolderHasMP4(basePath, username)
}

func (a *App) GetFolderPath(basePath, username string) string {
	return backend.GetFolderPath(basePath, username)
}

func (a *App) GetGifsFolderPath(basePath, username string) string {
	return backend.GetGifsFolderPath(basePath, username)
}

func openJSONImportDialog(ctx context.Context) (string, error) {
	return runtime.OpenFileDialog(ctx, runtime.OpenDialogOptions{
		Title: "Import Account JSON",
		Filters: []runtime.FileFilter{
			{DisplayName: "JSON Files", Pattern: "*.json"},
		},
	})
}

func openZipSaveDialog(ctx context.Context, title, defaultFilename string) (string, error) {
	defaultDirectory, err := os.UserHomeDir()
	if err != nil {
		defaultDirectory = backend.GetAppDataDir()
	}

	return runtime.SaveFileDialog(ctx, runtime.SaveDialogOptions{
		Title:                title,
		DefaultDirectory:     defaultDirectory,
		DefaultFilename:      defaultFilename,
		CanCreateDirectories: true,
		Filters: []runtime.FileFilter{
			{DisplayName: "ZIP Archives", Pattern: "*.zip"},
		},
	})
}

func openZipOpenDialog(ctx context.Context, title string) (string, error) {
	defaultDirectory, err := os.UserHomeDir()
	if err != nil {
		defaultDirectory = backend.GetAppDataDir()
	}

	return runtime.OpenFileDialog(ctx, runtime.OpenDialogOptions{
		Title:            title,
		DefaultDirectory: defaultDirectory,
		Filters: []runtime.FileFilter{
			{DisplayName: "ZIP Archives", Pattern: "*.zip"},
		},
	})
}

func timestampForFilename() string {
	return time.Now().Format("20060102-150405")
}
