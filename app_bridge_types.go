package main

import "twitterxmediabatchdownloader/backend"

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
	Cursor       string `json:"cursor,omitempty"`
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

type DownloadMediaRequest struct {
	URLs      []string `json:"urls"`
	OutputDir string   `json:"output_dir"`
	Username  string   `json:"username"`
	Proxy     string   `json:"proxy,omitempty"`
}

type MediaItemRequest struct {
	URL              string                `json:"url"`
	Date             string                `json:"date"`
	TweetID          backend.TweetIDString `json:"tweet_id"`
	Type             string                `json:"type"`
	Content          string                `json:"content,omitempty"`
	OriginalFilename string                `json:"original_filename,omitempty"`
	AuthorUsername   string                `json:"author_username,omitempty"`
}

type DownloadMediaWithMetadataRequest struct {
	Items     []MediaItemRequest `json:"items"`
	OutputDir string             `json:"output_dir"`
	Username  string             `json:"username"`
	Proxy     string             `json:"proxy,omitempty"`
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

type SavedAccountsQueryRequest struct {
	AccountViewMode string `json:"account_view_mode"`
	SearchQuery     string `json:"search_query"`
	FilterGroup     string `json:"filter_group"`
	FilterMediaType string `json:"filter_media_type"`
	SortOrder       string `json:"sort_order"`
	Offset          int    `json:"offset"`
	Limit           int    `json:"limit"`
}

type SavedAccountsIDsRequest struct {
	AccountViewMode string `json:"account_view_mode"`
	SearchQuery     string `json:"search_query"`
	FilterGroup     string `json:"filter_group"`
	FilterMediaType string `json:"filter_media_type"`
}

type DownloadMediaResponse struct {
	Success    bool   `json:"success"`
	Downloaded int    `json:"downloaded"`
	Skipped    int    `json:"skipped"`
	Failed     int    `json:"failed"`
	Message    string `json:"message"`
}

type DownloadStateResponse struct {
	InProgress bool `json:"in_progress"`
	Current    int  `json:"current"`
	Total      int  `json:"total"`
	Percent    int  `json:"percent"`
}

type DownloadItemStatus struct {
	TweetID int64  `json:"tweet_id"`
	Index   int    `json:"index"`
	Status  string `json:"status"`
}

type ConvertGIFsRequest struct {
	FolderPath     string `json:"folder_path"`
	Quality        string `json:"quality"`
	Resolution     string `json:"resolution"`
	DeleteOriginal bool   `json:"delete_original"`
}

type ConvertGIFsResponse struct {
	Success   bool   `json:"success"`
	Converted int    `json:"converted"`
	Failed    int    `json:"failed"`
	Message   string `json:"message"`
}

type CheckDownloadIntegrityRequest struct {
	DownloadPath string `json:"download_path"`
	Proxy        string `json:"proxy,omitempty"`
	Mode         string `json:"mode,omitempty"`
}

type DownloadIntegrityTaskStatusResponse struct {
	InProgress        bool                             `json:"in_progress"`
	Cancelled         bool                             `json:"cancelled"`
	Mode              string                           `json:"mode"`
	Phase             string                           `json:"phase"`
	ScannedFiles      int                              `json:"scanned_files"`
	CheckedFiles      int                              `json:"checked_files"`
	VerifiedFiles     int                              `json:"verified_files"`
	PartialFiles      int                              `json:"partial_files"`
	IncompleteFiles   int                              `json:"incomplete_files"`
	UntrackedFiles    int                              `json:"untracked_files"`
	UnverifiableFiles int                              `json:"unverifiable_files"`
	IssuesCount       int                              `json:"issues_count"`
	Error             string                           `json:"error,omitempty"`
	Report            *backend.DownloadIntegrityReport `json:"report,omitempty"`
}

type StoredAuthTokensResponse struct {
	PublicToken  string `json:"public_token"`
	PrivateToken string `json:"private_token"`
}

type ImportAccountResponse struct {
	Success  bool   `json:"success"`
	Username string `json:"username"`
	Message  string `json:"message"`
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
