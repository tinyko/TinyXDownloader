package main

import (
	"context"
	"fmt"
	"path/filepath"
	"twitterxmediabatchdownloader/backend"
	"twitterxmediabatchdownloader/internal/desktop/smoke"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

func (a *App) DownloadMedia(req DownloadMediaRequest) (DownloadMediaResponse, error) {
	if a.smoke != nil {
		return a.runSmokeDownloadSession(len(req.URLs))
	}

	if len(req.URLs) == 0 {
		return DownloadMediaResponse{Success: false, Message: "No URLs provided"}, fmt.Errorf("no URLs provided")
	}

	outputDir := req.OutputDir
	if outputDir == "" {
		outputDir = backend.GetDefaultDownloadPath()
	}
	if req.Username != "" {
		outputDir = filepath.Join(outputDir, req.Username)
	}

	downloaded, failed, err := backend.DownloadMediaFiles(req.URLs, outputDir, req.Proxy)
	if err != nil {
		return DownloadMediaResponse{
			Success:    false,
			Downloaded: downloaded,
			Skipped:    0,
			Failed:     failed,
			Message:    err.Error(),
		}, err
	}

	return DownloadMediaResponse{
		Success:    true,
		Downloaded: downloaded,
		Skipped:    0,
		Failed:     failed,
		Message:    fmt.Sprintf("Downloaded %d files, %d failed", downloaded, failed),
	}, nil
}

func (a *App) DownloadMediaWithMetadata(req DownloadMediaWithMetadataRequest) (DownloadMediaResponse, error) {
	if a.smoke != nil {
		return a.runSmokeDownloadSession(len(req.Items))
	}

	if len(req.Items) == 0 {
		return DownloadMediaResponse{Success: false, Message: "No items provided"}, fmt.Errorf("no items provided")
	}

	if err := a.beginDownloadSession(len(req.Items)); err != nil {
		return DownloadMediaResponse{Success: false, Message: err.Error()}, err
	}
	defer a.finishDownloadSession()

	outputDir := req.OutputDir
	if outputDir == "" {
		outputDir = backend.GetDefaultDownloadPath()
	}

	items := make([]backend.MediaItem, len(req.Items))
	for i, item := range req.Items {
		originalFilename := item.OriginalFilename
		if originalFilename == "" {
			originalFilename = backend.ExtractOriginalFilename(item.URL)
		}

		username := req.Username
		if item.AuthorUsername != "" {
			username = item.AuthorUsername
		}

		items[i] = backend.MediaItem{
			URL:              item.URL,
			Date:             item.Date,
			TweetID:          int64(item.TweetID),
			Type:             item.Type,
			Username:         username,
			Content:          item.Content,
			OriginalFilename: originalFilename,
		}
	}

	downloaded, skipped, failed, err := a.runDownloadItems(items, outputDir, req.Username, req.Proxy, len(items))
	if err != nil {
		return DownloadMediaResponse{
			Success:    false,
			Downloaded: downloaded,
			Skipped:    skipped,
			Failed:     failed,
			Message:    err.Error(),
		}, err
	}

	return DownloadMediaResponse{
		Success:    true,
		Downloaded: downloaded,
		Skipped:    skipped,
		Failed:     failed,
		Message:    fmt.Sprintf("Downloaded %d files, %d skipped, %d failed", downloaded, skipped, failed),
	}, nil
}

func (a *App) runDownloadItems(items []backend.MediaItem, outputDir, username, proxy string, totalItems int) (int, int, int, error) {
	progressCallback := func(current, _ int) {
		percent := 0
		if totalItems > 0 {
			percent = (current * 100) / totalItems
		}
		a.updateDownloadProgress(current, totalItems, percent)
	}

	itemStatusCallback := func(tweetID int64, index int, status string) {
		runtime.EventsEmit(a.ctx, "download-item-status", DownloadItemStatus{
			TweetID: tweetID,
			Index:   index,
			Status:  status,
		})
	}

	return backend.DownloadMediaWithMetadataProgressAndStatus(
		items,
		outputDir,
		username,
		progressCallback,
		itemStatusCallback,
		a.downloadCtx,
		proxy,
	)
}

func (a *App) runSavedScopeDownloads(payloads []*backend.ScopeMediaDownloadPayload, outputDir, proxy string, totalItems int) (int, int, int, error) {
	progressCallback := func(current, _ int) {
		percent := 0
		if totalItems > 0 {
			percent = (current * 100) / totalItems
		}
		a.updateDownloadProgress(current, totalItems, percent)
	}

	itemStatusCallback := func(tweetID int64, index int, status string) {
		runtime.EventsEmit(a.ctx, "download-item-status", DownloadItemStatus{
			TweetID: tweetID,
			Index:   index,
			Status:  status,
		})
	}

	return backend.DownloadScopePayloadsProgressAndStatus(
		payloads,
		outputDir,
		progressCallback,
		itemStatusCallback,
		a.downloadCtx,
		proxy,
	)
}

func (a *App) DownloadSavedScopes(req DownloadSavedScopesRequest) (DownloadMediaResponse, error) {
	if a.smoke != nil {
		return a.runSmokeDownloadSession(len(req.Scopes) * 6)
	}

	if len(req.Scopes) == 0 {
		return DownloadMediaResponse{Success: false, Message: "No scopes provided"}, fmt.Errorf("no scopes provided")
	}

	outputDir := req.OutputDir
	if outputDir == "" {
		outputDir = backend.GetDefaultDownloadPath()
	}

	payloads := make([]*backend.ScopeMediaDownloadPayload, 0, len(req.Scopes))
	totalItems := 0
	for _, scope := range req.Scopes {
		payload, err := backend.LoadScopeMediaDownloadPayload(toBackendFetchScope(scope))
		if err != nil {
			return DownloadMediaResponse{Success: false, Message: err.Error()}, err
		}
		if payload == nil || len(payload.Items) == 0 {
			continue
		}
		payloads = append(payloads, payload)
		totalItems += len(payload.Items)
	}

	if totalItems == 0 {
		return DownloadMediaResponse{
			Success: false,
			Message: "No saved media is ready to download",
		}, fmt.Errorf("no saved media is ready to download")
	}

	if err := a.beginDownloadSession(totalItems); err != nil {
		return DownloadMediaResponse{Success: false, Message: err.Error()}, err
	}
	defer a.finishDownloadSession()

	downloaded, skipped, failed, err := a.runSavedScopeDownloads(payloads, outputDir, req.Proxy, totalItems)
	if err != nil {
		return DownloadMediaResponse{
			Success:    false,
			Downloaded: downloaded,
			Skipped:    skipped,
			Failed:     failed,
			Message:    err.Error(),
		}, err
	}

	return DownloadMediaResponse{
		Success:    true,
		Downloaded: downloaded,
		Skipped:    skipped,
		Failed:     failed,
		Message:    fmt.Sprintf("Downloaded %d files, %d skipped, %d failed", downloaded, skipped, failed),
	}, nil
}

func (a *App) StopDownload() bool {
	a.downloadMu.Lock()
	cancel := a.downloadCancel
	a.downloadMu.Unlock()
	if cancel == nil {
		return false
	}
	cancel()
	return true
}

func (a *App) beginDownloadSession(total int) error {
	a.downloadMu.Lock()
	defer a.downloadMu.Unlock()

	if a.downloadState.InProgress {
		return fmt.Errorf("download already in progress")
	}

	a.downloadCtx, a.downloadCancel = context.WithCancel(context.Background())
	a.downloadState = DownloadStateResponse{
		InProgress: true,
		Current:    0,
		Total:      total,
		Percent:    0,
	}
	a.emitDownloadStateLocked()
	return nil
}

func (a *App) updateDownloadProgress(current, total, percent int) {
	a.downloadMu.Lock()
	a.downloadState = DownloadStateResponse{
		InProgress: true,
		Current:    current,
		Total:      total,
		Percent:    percent,
	}
	a.emitDownloadStateLocked()
	a.downloadMu.Unlock()
}

func (a *App) finishDownloadSession() {
	a.downloadMu.Lock()
	a.downloadCtx = nil
	a.downloadCancel = nil
	a.downloadState = DownloadStateResponse{}
	a.emitDownloadStateLocked()
	a.downloadMu.Unlock()
}

func (a *App) emitDownloadStateLocked() {
	if a.ctx == nil {
		return
	}
	runtime.EventsEmit(a.ctx, "download-state", a.downloadState)
}

func (a *App) GetDownloadStatus() DownloadStateResponse {
	a.downloadMu.Lock()
	defer a.downloadMu.Unlock()
	return a.downloadState
}

func (a *App) runSmokeDownloadSession(totalItems int) (DownloadMediaResponse, error) {
	if err := a.beginDownloadSession(totalItems); err != nil {
		return DownloadMediaResponse{Success: false, Message: err.Error()}, err
	}
	defer a.finishDownloadSession()

	result := smoke.RunDownloadSession(a.downloadCtx, totalItems, a.updateDownloadProgress)
	return DownloadMediaResponse{
		Success:    true,
		Downloaded: result.Downloaded,
		Skipped:    result.Skipped,
		Failed:     result.Failed,
		Message:    result.Message,
	}, nil
}
