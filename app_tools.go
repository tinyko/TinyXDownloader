package main

import (
	"context"
	"fmt"
	"path/filepath"
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
