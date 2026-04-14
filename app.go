package main

import (
	"context"
	"encoding/json"
	"fmt"
	"path/filepath"
	"sync"
	"twitterxmediabatchdownloader/backend"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// App struct
type App struct {
	ctx            context.Context
	downloadCtx    context.Context
	downloadCancel context.CancelFunc
	downloadMu     sync.Mutex
	downloadState  DownloadStateResponse
}

// NewApp creates a new App application struct
func NewApp() *App {
	return &App{}
}

// startup is called when the app starts. The context is saved
// so we can call the runtime methods
func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
	// Initialize database
	backend.InitDB()
	// Kill any leftover extractor processes from previous session
	backend.KillAllExtractorProcesses()
}

// shutdown is called when the app is closing
func (a *App) shutdown(ctx context.Context) {
	backend.CloseDB()
	// Kill any running extractor processes
	backend.KillAllExtractorProcesses()
}

// CleanupExtractorProcesses kills all running extractor processes
// Can be called from frontend when user wants to stop/reset
func (a *App) CleanupExtractorProcesses() {
	backend.KillAllExtractorProcesses()
}

// CancelExtractorRequest cancels a specific in-flight extractor request.
func (a *App) CancelExtractorRequest(requestID string) bool {
	return backend.CancelExtractorRequest(requestID)
}

// TimelineRequest represents the request structure for timeline extraction
type TimelineRequest struct {
	Username     string `json:"username"`
	AuthToken    string `json:"auth_token"`
	TimelineType string `json:"timeline_type"`
	BatchSize    int    `json:"batch_size"`
	Page         int    `json:"page"`
	MediaType    string `json:"media_type"`
	Retweets     bool   `json:"retweets"`
	RequestID    string `json:"request_id,omitempty"`
	Cursor       string `json:"cursor,omitempty"` // Resume from this cursor position
}

// DateRangeRequest represents the request structure for date range extraction
type DateRangeRequest struct {
	Username    string `json:"username"`
	AuthToken   string `json:"auth_token"`
	StartDate   string `json:"start_date"`
	EndDate     string `json:"end_date"`
	MediaFilter string `json:"media_filter"`
	Retweets    bool   `json:"retweets"`
	RequestID   string `json:"request_id,omitempty"`
}

// ExtractTimeline extracts media from user timeline
func (a *App) ExtractTimeline(req TimelineRequest) (string, error) {
	// Username not required for bookmarks only
	if req.Username == "" && req.TimelineType != "bookmarks" {
		return "", fmt.Errorf("username is required")
	}
	if req.AuthToken == "" {
		return "", fmt.Errorf("auth token is required")
	}

	backendReq := backend.TimelineRequest{
		Username:     req.Username,
		AuthToken:    req.AuthToken,
		TimelineType: req.TimelineType,
		BatchSize:    req.BatchSize,
		Page:         req.Page,
		MediaType:    req.MediaType,
		Retweets:     req.Retweets,
		RequestID:    req.RequestID,
		Cursor:       req.Cursor,
	}

	response, err := backend.ExtractTimeline(backendReq)
	if err != nil {
		return "", fmt.Errorf("failed to extract timeline: %v", err)
	}

	jsonData, err := json.MarshalIndent(response, "", "  ")
	if err != nil {
		return "", fmt.Errorf("failed to encode response: %v", err)
	}

	return string(jsonData), nil
}

// ExtractTimelineStructured extracts media from user timeline and returns
// the structured response directly for hot-path frontend usage.
func (a *App) ExtractTimelineStructured(req TimelineRequest) (*backend.TwitterResponse, error) {
	// Username not required for bookmarks only
	if req.Username == "" && req.TimelineType != "bookmarks" {
		return nil, fmt.Errorf("username is required")
	}
	if req.AuthToken == "" {
		return nil, fmt.Errorf("auth token is required")
	}

	backendReq := backend.TimelineRequest{
		Username:     req.Username,
		AuthToken:    req.AuthToken,
		TimelineType: req.TimelineType,
		BatchSize:    req.BatchSize,
		Page:         req.Page,
		MediaType:    req.MediaType,
		Retweets:     req.Retweets,
		RequestID:    req.RequestID,
		Cursor:       req.Cursor,
	}

	response, err := backend.ExtractTimeline(backendReq)
	if err != nil {
		return nil, fmt.Errorf("failed to extract timeline: %v", err)
	}

	return response, nil
}

// ExtractDateRange extracts media based on date range
func (a *App) ExtractDateRange(req DateRangeRequest) (string, error) {
	if req.Username == "" {
		return "", fmt.Errorf("username is required")
	}
	if req.AuthToken == "" {
		return "", fmt.Errorf("auth token is required")
	}
	if req.StartDate == "" {
		return "", fmt.Errorf("start date is required")
	}
	if req.EndDate == "" {
		return "", fmt.Errorf("end date is required")
	}

	backendReq := backend.DateRangeRequest{
		Username:    req.Username,
		AuthToken:   req.AuthToken,
		StartDate:   req.StartDate,
		EndDate:     req.EndDate,
		MediaFilter: req.MediaFilter,
		Retweets:    req.Retweets,
		RequestID:   req.RequestID,
	}

	response, err := backend.ExtractDateRange(backendReq)
	if err != nil {
		return "", fmt.Errorf("failed to extract date range: %v", err)
	}

	jsonData, err := json.MarshalIndent(response, "", "  ")
	if err != nil {
		return "", fmt.Errorf("failed to encode response: %v", err)
	}

	return string(jsonData), nil
}

// ExtractDateRangeStructured extracts media by date range and returns the
// structured response directly for hot-path frontend usage.
func (a *App) ExtractDateRangeStructured(req DateRangeRequest) (*backend.TwitterResponse, error) {
	if req.Username == "" {
		return nil, fmt.Errorf("username is required")
	}
	if req.AuthToken == "" {
		return nil, fmt.Errorf("auth token is required")
	}
	if req.StartDate == "" {
		return nil, fmt.Errorf("start date is required")
	}
	if req.EndDate == "" {
		return nil, fmt.Errorf("end date is required")
	}

	backendReq := backend.DateRangeRequest{
		Username:    req.Username,
		AuthToken:   req.AuthToken,
		StartDate:   req.StartDate,
		EndDate:     req.EndDate,
		MediaFilter: req.MediaFilter,
		Retweets:    req.Retweets,
		RequestID:   req.RequestID,
	}

	response, err := backend.ExtractDateRange(backendReq)
	if err != nil {
		return nil, fmt.Errorf("failed to extract date range: %v", err)
	}

	return response, nil
}

// OpenFolder opens a folder in the file explorer
func (a *App) OpenFolder(path string) error {
	if path == "" {
		return fmt.Errorf("path is required")
	}

	// Clean the path to use correct separators for the OS
	cleanPath := filepath.Clean(path)

	err := backend.OpenFolderInExplorer(cleanPath)
	if err != nil {
		return fmt.Errorf("failed to open folder: %v", err)
	}

	return nil
}

// SelectFolder opens a folder selection dialog and returns the selected path
func (a *App) SelectFolder(defaultPath string) (string, error) {
	return backend.SelectFolderDialog(a.ctx, defaultPath)
}

// GetDefaults returns the default configuration
func (a *App) GetDefaults() map[string]string {
	return map[string]string{
		"downloadPath": backend.GetDefaultDownloadPath(),
	}
}

// Quit closes the application
func (a *App) Quit() {
	panic("quit")
}

// DownloadMediaRequest represents the request for downloading media (legacy)
type DownloadMediaRequest struct {
	URLs      []string `json:"urls"`
	OutputDir string   `json:"output_dir"`
	Username  string   `json:"username"`
	Proxy     string   `json:"proxy,omitempty"` // Optional proxy URL (e.g., http://proxy:port or socks5://proxy:port)
}

// MediaItemRequest represents a media item with metadata
type MediaItemRequest struct {
	URL              string                `json:"url"`
	Date             string                `json:"date"`
	TweetID          backend.TweetIDString `json:"tweet_id"`
	Type             string                `json:"type"`
	Content          string                `json:"content,omitempty"`           // Tweet text content (for text-only tweets)
	OriginalFilename string                `json:"original_filename,omitempty"` // Original filename from API
	AuthorUsername   string                `json:"author_username,omitempty"`   // Username of tweet author (for bookmarks and likes)
}

// DownloadMediaWithMetadataRequest represents the request for downloading media with metadata
type DownloadMediaWithMetadataRequest struct {
	Items     []MediaItemRequest `json:"items"`
	OutputDir string             `json:"output_dir"`
	Username  string             `json:"username"`
	Proxy     string             `json:"proxy,omitempty"` // Optional proxy URL (e.g., http://proxy:port or socks5://proxy:port)
}

type FetchScopeRequest struct {
	Username     string `json:"username"`
	MediaType    string `json:"media_type"`
	TimelineType string `json:"timeline_type"`
	Retweets     bool   `json:"retweets"`
	QueryKey     string `json:"query_key"`
}

type SaveAccountSnapshotChunkRequest struct {
	Scope       FetchScopeRequest       `json:"scope"`
	AccountInfo backend.AccountInfo     `json:"account_info"`
	Entries     []backend.TimelineEntry `json:"entries"`
	Cursor      string                  `json:"cursor"`
	Completed   bool                    `json:"completed"`
	TotalMedia  int                     `json:"total_media"`
}

type DownloadSavedScopesRequest struct {
	Scopes    []FetchScopeRequest `json:"scopes"`
	OutputDir string              `json:"output_dir"`
	Proxy     string              `json:"proxy,omitempty"`
}

type AccountTimelinePageRequest struct {
	Scope      FetchScopeRequest `json:"scope"`
	Offset     int               `json:"offset"`
	Limit      int               `json:"limit"`
	FilterType string            `json:"filter_type"`
	SortBy     string            `json:"sort_by"`
}

type AccountTimelineBootstrapRequest struct {
	Scope      FetchScopeRequest `json:"scope"`
	FilterType string            `json:"filter_type"`
}

type AccountTimelineItemsPageRequest struct {
	Scope      FetchScopeRequest `json:"scope"`
	Offset     int               `json:"offset"`
	Limit      int               `json:"limit"`
	FilterType string            `json:"filter_type"`
	SortBy     string            `json:"sort_by"`
}

// DownloadMediaResponse represents the response for download operation
type DownloadMediaResponse struct {
	Success    bool   `json:"success"`
	Downloaded int    `json:"downloaded"`
	Skipped    int    `json:"skipped"`
	Failed     int    `json:"failed"`
	Message    string `json:"message"`
}

func toBackendFetchScope(scope FetchScopeRequest) backend.FetchScopeRecord {
	return backend.FetchScopeRecord{
		Username:     scope.Username,
		MediaType:    scope.MediaType,
		TimelineType: scope.TimelineType,
		Retweets:     scope.Retweets,
		QueryKey:     scope.QueryKey,
	}
}

// DownloadMedia downloads media files from URLs (legacy)
func (a *App) DownloadMedia(req DownloadMediaRequest) (DownloadMediaResponse, error) {
	if len(req.URLs) == 0 {
		return DownloadMediaResponse{
			Success: false,
			Message: "No URLs provided",
		}, fmt.Errorf("no URLs provided")
	}

	outputDir := req.OutputDir
	if outputDir == "" {
		outputDir = backend.GetDefaultDownloadPath()
	}

	// Create subfolder for username if provided
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

// DownloadStateResponse represents the active download session state.
type DownloadStateResponse struct {
	InProgress bool `json:"in_progress"`
	Current    int  `json:"current"`
	Total      int  `json:"total"`
	Percent    int  `json:"percent"`
}

// DownloadItemStatus represents per-item download status event data
type DownloadItemStatus struct {
	TweetID int64  `json:"tweet_id"`
	Index   int    `json:"index"`
	Status  string `json:"status"` // "success", "failed", "skipped"
}

// DownloadMediaWithMetadata downloads media files with proper naming and categorization
func (a *App) DownloadMediaWithMetadata(req DownloadMediaWithMetadataRequest) (DownloadMediaResponse, error) {
	if len(req.Items) == 0 {
		return DownloadMediaResponse{
			Success: false,
			Message: "No items provided",
		}, fmt.Errorf("no items provided")
	}

	if err := a.beginDownloadSession(len(req.Items)); err != nil {
		return DownloadMediaResponse{
			Success: false,
			Message: err.Error(),
		}, err
	}
	defer a.finishDownloadSession()

	outputDir := req.OutputDir
	if outputDir == "" {
		outputDir = backend.GetDefaultDownloadPath()
	}

	// Convert request items to backend items
	// For bookmarks and likes, use author_username from each item if available
	items := make([]backend.MediaItem, len(req.Items))
	for i, item := range req.Items {
		// Use original filename from API if available, otherwise extract from URL
		originalFilename := item.OriginalFilename
		if originalFilename == "" {
			// Fallback: extract from URL if not provided in API response
			originalFilename = backend.ExtractOriginalFilename(item.URL)
		}

		// For bookmarks and likes, use author_username from item, otherwise use req.Username
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

	return backend.DownloadMediaWithMetadataProgressAndStatus(items, outputDir, username, progressCallback, itemStatusCallback, a.downloadCtx, proxy)
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

	return backend.DownloadScopePayloadsProgressAndStatus(payloads, outputDir, progressCallback, itemStatusCallback, a.downloadCtx, proxy)
}

func (a *App) SaveAccountSnapshotChunk(req SaveAccountSnapshotChunkRequest) error {
	return backend.SaveAccountSnapshotChunk(
		toBackendFetchScope(req.Scope),
		req.AccountInfo,
		req.Entries,
		req.Cursor,
		req.Completed,
		req.TotalMedia,
	)
}

func (a *App) GetAccountSnapshotStructured(scope FetchScopeRequest) (*backend.TwitterResponse, error) {
	return backend.GetAccountResponseByScopeStructured(
		scope.Username,
		scope.MediaType,
		scope.TimelineType,
		scope.Retweets,
		scope.QueryKey,
	)
}

func (a *App) GetAccountSnapshotSummaryStructured(scope FetchScopeRequest) (*backend.AccountSnapshotSummary, error) {
	return backend.GetAccountSnapshotSummaryStructured(
		scope.Username,
		scope.MediaType,
		scope.TimelineType,
		scope.Retweets,
		scope.QueryKey,
	)
}

func (a *App) GetAccountSnapshotTweetIDs(scope FetchScopeRequest) ([]string, error) {
	return backend.GetAccountSnapshotTweetIDs(toBackendFetchScope(scope))
}

func (a *App) GetAccountTimelinePage(req AccountTimelinePageRequest) (*backend.AccountTimelinePage, error) {
	return backend.GetAccountTimelinePage(
		toBackendFetchScope(req.Scope),
		req.Offset,
		req.Limit,
		req.FilterType,
		req.SortBy,
	)
}

func (a *App) GetAccountTimelineBootstrap(req AccountTimelineBootstrapRequest) (*backend.AccountTimelineBootstrap, error) {
	return backend.GetAccountTimelineBootstrap(
		toBackendFetchScope(req.Scope),
		req.FilterType,
	)
}

func (a *App) GetAccountTimelineItemsPage(req AccountTimelineItemsPageRequest) (*backend.AccountTimelineItemsPage, error) {
	return backend.GetAccountTimelineItemsPage(
		toBackendFetchScope(req.Scope),
		req.Offset,
		req.Limit,
		req.FilterType,
		req.SortBy,
	)
}

func (a *App) DownloadSavedScopes(req DownloadSavedScopesRequest) (DownloadMediaResponse, error) {
	if len(req.Scopes) == 0 {
		return DownloadMediaResponse{
			Success: false,
			Message: "No scopes provided",
		}, fmt.Errorf("no scopes provided")
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
			return DownloadMediaResponse{
				Success: false,
				Message: err.Error(),
			}, err
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
		return DownloadMediaResponse{
			Success: false,
			Message: err.Error(),
		}, err
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

// StopDownload cancels the current download operation
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

// GetDownloadStatus returns the current download session state.
func (a *App) GetDownloadStatus() DownloadStateResponse {
	a.downloadMu.Lock()
	defer a.downloadMu.Unlock()
	return a.downloadState
}

// Database functions

// SaveAccountToDB saves account data to database
func (a *App) SaveAccountToDB(username, name, profileImage string, totalMedia int, responseJSON string, mediaType string) error {
	return backend.SaveAccount(username, name, profileImage, totalMedia, responseJSON, mediaType)
}

// SaveAccountToDBWithStatus saves account data with cursor and completion status for resume capability
func (a *App) SaveAccountToDBWithStatus(username, name, profileImage string, totalMedia int, responseJSON string, mediaType string, timelineType string, retweets bool, queryKey string, cursor string, completed bool) error {
	return backend.SaveAccountWithStatus(username, name, profileImage, totalMedia, responseJSON, mediaType, timelineType, retweets, queryKey, cursor, completed)
}

// GetAllAccountsFromDB returns all saved accounts
func (a *App) GetAllAccountsFromDB() ([]backend.AccountListItem, error) {
	return backend.GetAllAccounts()
}

func (a *App) GetSavedAccountsWorkspaceData() (*backend.SavedAccountsWorkspaceData, error) {
	return backend.GetSavedAccountsWorkspaceData()
}

// GetAccountSnapshotFromDB returns saved response JSON for an exact fetch scope.
func (a *App) GetAccountSnapshotFromDB(username, mediaType, timelineType string, retweets bool, queryKey string) (string, error) {
	return backend.GetAccountResponseByScope(username, mediaType, timelineType, retweets, queryKey)
}

// GetAccountFromDB returns account data by ID
func (a *App) GetAccountFromDB(id int64) (string, error) {
	acc, err := backend.GetAccountByID(id)
	if err != nil {
		return "", err
	}
	return acc.ResponseJSON, nil
}

// DeleteAccountFromDB deletes an account from database
func (a *App) DeleteAccountFromDB(id int64) error {
	return backend.DeleteAccount(id)
}

// ClearAllAccountsFromDB deletes all accounts from database
func (a *App) ClearAllAccountsFromDB() error {
	return backend.ClearAllAccounts()
}

// ExportAccountJSON exports account to JSON file in specified directory
func (a *App) ExportAccountJSON(id int64, outputDir string) (string, error) {
	return backend.ExportAccountToFile(id, outputDir)
}

// ExportAccountsTXT exports selected accounts to TXT file in specified directory
func (a *App) ExportAccountsTXT(ids []int64, outputDir string) (string, error) {
	return backend.ExportAccountsToTXT(ids, outputDir)
}

// UpdateAccountGroup updates the group for an account
func (a *App) UpdateAccountGroup(id int64, groupName, groupColor string) error {
	return backend.UpdateAccountGroup(id, groupName, groupColor)
}

// GetAllGroups returns all unique groups
func (a *App) GetAllGroups() ([]map[string]string, error) {
	return backend.GetAllGroups()
}

// FFmpeg functions

// IsFFmpegInstalled checks if ffmpeg is available
func (a *App) IsFFmpegInstalled() bool {
	return backend.IsFFmpegInstalled()
}

// DownloadFFmpeg downloads ffmpeg binary
func (a *App) DownloadFFmpeg() error {
	return backend.DownloadFFmpeg(nil)
}

// IsExifToolInstalled checks if exiftool is available
func (a *App) IsExifToolInstalled() bool {
	return backend.IsExifToolInstalled()
}

// DownloadExifTool downloads exiftool binary
func (a *App) DownloadExifTool() error {
	return backend.DownloadExifTool(nil)
}

// ConvertGIFsRequest represents request for converting GIFs
type ConvertGIFsRequest struct {
	FolderPath     string `json:"folder_path"`
	Quality        string `json:"quality"`    // "fast" or "better"
	Resolution     string `json:"resolution"` // "original", "high", "medium", "low"
	DeleteOriginal bool   `json:"delete_original"`
}

// ConvertGIFsResponse represents response for GIF conversion
type ConvertGIFsResponse struct {
	Success   bool   `json:"success"`
	Converted int    `json:"converted"`
	Failed    int    `json:"failed"`
	Message   string `json:"message"`
}

// CheckDownloadIntegrityRequest represents request for validating downloaded files.
type CheckDownloadIntegrityRequest struct {
	DownloadPath string `json:"download_path"`
	Proxy        string `json:"proxy,omitempty"`
	Mode         string `json:"mode,omitempty"`
}

// StoredAuthTokensResponse represents locally persisted auth tokens for this device.
type StoredAuthTokensResponse struct {
	PublicToken  string `json:"public_token"`
	PrivateToken string `json:"private_token"`
}

// ConvertGIFs converts MP4 files in gifs folder to actual GIF format
func (a *App) ConvertGIFs(req ConvertGIFsRequest) (ConvertGIFsResponse, error) {
	if !backend.IsFFmpegInstalled() {
		return ConvertGIFsResponse{
			Success: false,
			Message: "FFmpeg not installed. Please download it first.",
		}, nil
	}

	// Default values if not provided
	quality := req.Quality
	if quality == "" {
		quality = "fast"
	}
	resolution := req.Resolution
	if resolution == "" {
		resolution = "high"
	}

	converted, failed, err := backend.ConvertGIFsInFolder(req.FolderPath, quality, resolution, req.DeleteOriginal)
	if err != nil {
		return ConvertGIFsResponse{
			Success: false,
			Message: err.Error(),
		}, err
	}

	return ConvertGIFsResponse{
		Success:   true,
		Converted: converted,
		Failed:    failed,
		Message:   fmt.Sprintf("Converted %d GIFs, %d failed", converted, failed),
	}, nil
}

// CheckDownloadIntegrity scans the current download directory for partial and truncated files.
func (a *App) CheckDownloadIntegrity(req CheckDownloadIntegrityRequest) (backend.DownloadIntegrityReport, error) {
	return backend.CheckDownloadIntegrity(req.DownloadPath, req.Proxy, req.Mode)
}

// GetStoredAuthTokens returns locally persisted auth tokens for this device.
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

// SaveStoredAuthTokens updates locally persisted auth tokens for this device.
func (a *App) SaveStoredAuthTokens(tokens StoredAuthTokensResponse) error {
	return backend.SaveStoredAuthTokens(backend.StoredAuthTokens{
		PublicToken:  tokens.PublicToken,
		PrivateToken: tokens.PrivateToken,
	})
}

// ImportAccountResponse represents the response for import operation
type ImportAccountResponse struct {
	Success  bool   `json:"success"`
	Username string `json:"username"`
	Message  string `json:"message"`
}

// CheckFolderExists checks if a folder exists for the given username
func (a *App) CheckFolderExists(basePath, username string) bool {
	return backend.CheckFolderExists(basePath, username)
}

// CheckFoldersExist checks if multiple folders exist under the given base path.
func (a *App) CheckFoldersExist(basePath string, folderNames []string) map[string]bool {
	return backend.CheckFoldersExist(basePath, folderNames)
}

// GetDownloadDirectorySnapshot returns the top-level directory names in the current download path.
func (a *App) GetDownloadDirectorySnapshot(basePath string) ([]string, error) {
	return backend.GetDownloadDirectorySnapshot(basePath)
}

// CheckGifsFolderExists checks if a gifs subfolder exists for the given username
func (a *App) CheckGifsFolderExists(basePath, username string) bool {
	return backend.CheckGifsFolderExists(basePath, username)
}

// CheckGifsFolderHasMP4 checks if the gifs folder has any MP4 files to convert
func (a *App) CheckGifsFolderHasMP4(basePath, username string) bool {
	return backend.CheckGifsFolderHasMP4(basePath, username)
}

// GetFolderPath returns the full path for a username folder
func (a *App) GetFolderPath(basePath, username string) string {
	return backend.GetFolderPath(basePath, username)
}

// GetGifsFolderPath returns the full path for a username's gifs folder
func (a *App) GetGifsFolderPath(basePath, username string) string {
	return backend.GetGifsFolderPath(basePath, username)
}

// ImportAccountFromJSON imports account from JSON file (supports both old and new format)
func (a *App) ImportAccountFromJSON() (ImportAccountResponse, error) {
	// Open file dialog
	filePath, err := runtime.OpenFileDialog(a.ctx, runtime.OpenDialogOptions{
		Title: "Import Account JSON",
		Filters: []runtime.FileFilter{
			{DisplayName: "JSON Files", Pattern: "*.json"},
		},
	})
	if err != nil {
		return ImportAccountResponse{Success: false, Message: err.Error()}, err
	}

	// User cancelled
	if filePath == "" {
		return ImportAccountResponse{Success: false, Message: "Cancelled"}, nil
	}

	// Import the file
	username, err := backend.ImportAccountFromFile(filePath)
	if err != nil {
		return ImportAccountResponse{Success: false, Message: err.Error()}, err
	}

	return ImportAccountResponse{
		Success:  true,
		Username: username,
		Message:  fmt.Sprintf("Successfully imported @%s", username),
	}, nil
}
