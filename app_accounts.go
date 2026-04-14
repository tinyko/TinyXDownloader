package main

import (
	"fmt"
	"twitterxmediabatchdownloader/backend"
)

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

func (a *App) SaveAccountToDB(username, name, profileImage string, totalMedia int, responseJSON string, mediaType string) error {
	return backend.SaveAccount(username, name, profileImage, totalMedia, responseJSON, mediaType)
}

func (a *App) SaveAccountToDBWithStatus(username, name, profileImage string, totalMedia int, responseJSON string, mediaType string, timelineType string, retweets bool, queryKey string, cursor string, completed bool) error {
	return backend.SaveAccountWithStatus(username, name, profileImage, totalMedia, responseJSON, mediaType, timelineType, retweets, queryKey, cursor, completed)
}

func (a *App) GetAllAccountsFromDB() ([]backend.AccountListItem, error) {
	return backend.GetAllAccounts()
}

func (a *App) GetSavedAccountsWorkspaceData() (*backend.SavedAccountsWorkspaceData, error) {
	return backend.GetSavedAccountsWorkspaceData()
}

func (a *App) GetSavedAccountsBootstrap() (*backend.SavedAccountsBootstrap, error) {
	return backend.GetSavedAccountsBootstrap()
}

func (a *App) QuerySavedAccounts(req SavedAccountsQueryRequest) (*backend.SavedAccountsQueryPage, error) {
	return backend.GetSavedAccountsQueryPage(
		req.AccountViewMode,
		req.SearchQuery,
		req.FilterGroup,
		req.FilterMediaType,
		req.SortOrder,
		req.Offset,
		req.Limit,
	)
}

func (a *App) GetSavedAccountMatchingIDs(req SavedAccountsIDsRequest) ([]int64, error) {
	return backend.GetSavedAccountMatchingIDs(
		req.AccountViewMode,
		req.SearchQuery,
		req.FilterGroup,
		req.FilterMediaType,
	)
}

func (a *App) GetAccountsByIDs(ids []int64) ([]backend.AccountListItem, error) {
	return backend.GetAccountsByIDs(ids)
}

func (a *App) GetAccountSnapshotFromDB(username, mediaType, timelineType string, retweets bool, queryKey string) (string, error) {
	return backend.GetAccountResponseByScope(username, mediaType, timelineType, retweets, queryKey)
}

func (a *App) GetAccountFromDB(id int64) (string, error) {
	acc, err := backend.GetAccountByID(id)
	if err != nil {
		return "", err
	}
	return acc.ResponseJSON, nil
}

func (a *App) DeleteAccountFromDB(id int64) error {
	return backend.DeleteAccount(id)
}

func (a *App) ClearAllAccountsFromDB() error {
	return backend.ClearAllAccounts()
}

func (a *App) ExportAccountJSON(id int64, outputDir string) (string, error) {
	return backend.ExportAccountToFile(id, outputDir)
}

func (a *App) ExportAccountsTXT(ids []int64, outputDir string) (string, error) {
	return backend.ExportAccountsToTXT(ids, outputDir)
}

func (a *App) UpdateAccountGroup(id int64, groupName, groupColor string) error {
	return backend.UpdateAccountGroup(id, groupName, groupColor)
}

func (a *App) GetAllGroups() ([]map[string]string, error) {
	return backend.GetAllGroups()
}

func (a *App) ImportAccountFromJSON() (ImportAccountResponse, error) {
	filePath, err := openJSONImportDialog(a.ctx)
	if err != nil {
		return ImportAccountResponse{Success: false, Message: err.Error()}, err
	}
	if filePath == "" {
		return ImportAccountResponse{Success: false, Message: "Cancelled"}, nil
	}

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
