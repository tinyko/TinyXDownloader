package backend

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"
	"time"
)

const accountTimelineItemsTableSchema = `
	CREATE TABLE IF NOT EXISTS account_timeline_items (
		fetch_key TEXT NOT NULL,
		entry_key TEXT NOT NULL,
		url TEXT NOT NULL,
		tweet_id TEXT NOT NULL,
		type TEXT NOT NULL,
		date_value TEXT NOT NULL,
		date_unix_ms INTEGER DEFAULT 0,
		tweet_id_num INTEGER,
		entry_json TEXT NOT NULL,
		PRIMARY KEY (fetch_key, entry_key)
	)
`

type FetchScopeRecord struct {
	Username     string `json:"username"`
	MediaType    string `json:"media_type"`
	TimelineType string `json:"timeline_type"`
	Retweets     bool   `json:"retweets"`
	QueryKey     string `json:"query_key"`
}

type accountSummaryRecord struct {
	ID             int64
	Username       string
	Name           string
	ProfileImage   string
	AccountInfoJSON string
	TotalMedia     int
	LastFetched    time.Time
	ResponseJSON   string
	MediaType      string
	TimelineType   string
	Retweets       bool
	QueryKey       string
	Cursor         string
	Completed      bool
	FollowersCount int
	StatusesCount  int
	FetchKey       string
	StorageVersion int
}

type ScopeMediaDownloadPayload struct {
	Scope            FetchScopeRecord
	Username         string
	RootSubdirectory string
	Items            []MediaItem
}

func normalizeFetchScopeRecord(scope FetchScopeRecord) FetchScopeRecord {
	normalized := FetchScopeRecord{
		Username:     strings.TrimSpace(scope.Username),
		MediaType:    strings.TrimSpace(scope.MediaType),
		TimelineType: strings.TrimSpace(scope.TimelineType),
		Retweets:     scope.Retweets,
		QueryKey:     strings.TrimSpace(scope.QueryKey),
	}
	if normalized.MediaType == "" {
		normalized.MediaType = "all"
	}
	if normalized.TimelineType == "" {
		normalized.TimelineType = "timeline"
	}
	return normalized
}

func buildFetchKeyFromScope(scope FetchScopeRecord) string {
	normalized := normalizeFetchScopeRecord(scope)
	return buildFetchKey(
		normalized.Username,
		normalized.MediaType,
		normalized.TimelineType,
		normalized.Retweets,
		normalized.QueryKey,
	)
}

func buildTimelineEntryStorageKey(entry TimelineEntry) string {
	return fmt.Sprintf("%d|%s", int64(entry.TweetID), strings.TrimSpace(entry.URL))
}

func parseTimelineEntryDateUnixMs(value string) int64 {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return 0
	}

	layouts := []string{
		time.RFC3339Nano,
		time.RFC3339,
		"2006-01-02T15:04:05",
		"2006-01-02t15:04:05",
		"2006-01-02 15:04:05",
		"2006-01-02",
	}

	for _, layout := range layouts {
		parsed, err := time.Parse(layout, trimmed)
		if err == nil {
			return parsed.UnixMilli()
		}
	}

	return 0
}

func ensureAccountsStorageColumns(columns map[string]bool) (bool, error) {
	added := false
	if !columns["storage_version"] {
		if _, err := db.Exec(`ALTER TABLE accounts ADD COLUMN storage_version INTEGER DEFAULT 1`); err != nil {
			return false, err
		}
		added = true
	}
	if !columns["account_info_json"] {
		if _, err := db.Exec(`ALTER TABLE accounts ADD COLUMN account_info_json TEXT DEFAULT ''`); err != nil {
			return false, err
		}
		added = true
	}
	return added, nil
}

func ensureAccountTimelineItemsSchema() error {
	if _, err := db.Exec(accountTimelineItemsTableSchema); err != nil {
		return err
	}
	if _, err := db.Exec(`
		CREATE INDEX IF NOT EXISTS idx_account_timeline_items_scope_order
		ON account_timeline_items(fetch_key, date_unix_ms DESC, tweet_id_num DESC)
	`); err != nil {
		return err
	}
	if _, err := db.Exec(`
		CREATE INDEX IF NOT EXISTS idx_account_timeline_items_scope_type
		ON account_timeline_items(fetch_key, type)
	`); err != nil {
		return err
	}
	return nil
}

func saveAccountSnapshotChunkTx(
	tx *sql.Tx,
	scope FetchScopeRecord,
	accountInfo AccountInfo,
	entries []TimelineEntry,
	cursor string,
	completed bool,
	totalMedia int,
	lastFetched time.Time,
) error {
	normalizedScope := normalizeFetchScopeRecord(scope)
	if totalMedia < 0 {
		totalMedia = 0
	}

	username := strings.TrimSpace(accountInfo.Name)
	if username == "" {
		username = normalizedScope.Username
	}
	displayName := strings.TrimSpace(accountInfo.Nick)
	profileImage := strings.TrimSpace(accountInfo.ProfileImage)
	fetchKey := buildFetchKeyFromScope(normalizedScope)
	accountInfoJSON, err := json.Marshal(accountInfo)
	if err != nil {
		return err
	}

	completedInt := 0
	if completed {
		completedInt = 1
	}
	retweetsInt := 0
	if normalizedScope.Retweets {
		retweetsInt = 1
	}

	if _, err := tx.Exec(`
		INSERT INTO accounts (
			username, name, profile_image, total_media, last_fetched,
			account_info_json,
			media_type, timeline_type, retweets, query_key,
			followers_count, statuses_count, fetch_key, cursor, completed, storage_version
		)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 2)
		ON CONFLICT(fetch_key) DO UPDATE SET
			username = excluded.username,
			name = excluded.name,
			profile_image = excluded.profile_image,
			total_media = excluded.total_media,
			last_fetched = excluded.last_fetched,
			account_info_json = excluded.account_info_json,
			media_type = excluded.media_type,
			timeline_type = excluded.timeline_type,
			retweets = excluded.retweets,
			query_key = excluded.query_key,
			followers_count = excluded.followers_count,
			statuses_count = excluded.statuses_count,
			cursor = excluded.cursor,
			completed = excluded.completed,
			storage_version = 2
	`, username, displayName, profileImage, totalMedia, lastFetched, string(accountInfoJSON), normalizedScope.MediaType, normalizedScope.TimelineType, retweetsInt, normalizedScope.QueryKey, accountInfo.FollowersCount, accountInfo.StatusesCount, fetchKey, cursor, completedInt); err != nil {
		return err
	}

	if len(entries) == 0 {
		return nil
	}

	stmt, err := tx.Prepare(`
		INSERT INTO account_timeline_items (
			fetch_key, entry_key, url, tweet_id, type, date_value, date_unix_ms, tweet_id_num, entry_json
		)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(fetch_key, entry_key) DO NOTHING
	`)
	if err != nil {
		return err
	}
	defer stmt.Close()

	for _, entry := range entries {
		entryJSON, err := json.Marshal(entry)
		if err != nil {
			return err
		}

		if _, err := stmt.Exec(
			fetchKey,
			buildTimelineEntryStorageKey(entry),
			strings.TrimSpace(entry.URL),
			fmt.Sprintf("%d", int64(entry.TweetID)),
			strings.TrimSpace(entry.Type),
			strings.TrimSpace(entry.Date),
			parseTimelineEntryDateUnixMs(entry.Date),
			int64(entry.TweetID),
			string(entryJSON),
		); err != nil {
			return err
		}
	}

	return nil
}

func SaveAccountSnapshotChunk(scope FetchScopeRecord, accountInfo AccountInfo, entries []TimelineEntry, cursor string, completed bool, totalMedia int) error {
	if db == nil {
		if err := InitDB(); err != nil {
			return err
		}
	}

	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	if err := saveAccountSnapshotChunkTx(tx, scope, accountInfo, entries, cursor, completed, totalMedia, time.Now()); err != nil {
		return err
	}

	return tx.Commit()
}

func SaveAccountResponseStructured(scope FetchScopeRecord, response TwitterResponse) error {
	totalMedia := response.TotalURLs
	if totalMedia == 0 && len(response.Timeline) > 0 {
		totalMedia = len(response.Timeline)
	}

	cursor := strings.TrimSpace(response.Cursor)
	if cursor == "" {
		cursor = strings.TrimSpace(response.Metadata.Cursor)
	}

	completed := response.Completed || response.Metadata.Completed
	return SaveAccountSnapshotChunk(scope, response.AccountInfo, response.Timeline, cursor, completed, totalMedia)
}

func getAccountSummaryByFetchKey(fetchKey string) (*accountSummaryRecord, error) {
	var summary accountSummaryRecord
	var lastFetched time.Time
	var retweetsInt int
	var completedInt int

	err := db.QueryRow(`
		SELECT id, username, name, profile_image, COALESCE(account_info_json, ''), total_media, last_fetched, COALESCE(response_json, ''),
		       COALESCE(media_type, 'all'), COALESCE(timeline_type, 'timeline'),
		       COALESCE(retweets, 0), COALESCE(query_key, ''), COALESCE(cursor, ''),
		       COALESCE(completed, 1), COALESCE(followers_count, 0), COALESCE(statuses_count, 0),
		       fetch_key, COALESCE(storage_version, 1)
		FROM accounts
		WHERE fetch_key = ?
	`, fetchKey).Scan(
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
	)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}

	summary.LastFetched = lastFetched
	summary.Retweets = retweetsInt == 1
	summary.Completed = completedInt == 1

	return &summary, nil
}

func getAccountSummaryByID(id int64) (*accountSummaryRecord, error) {
	var summary accountSummaryRecord
	var lastFetched time.Time
	var retweetsInt int
	var completedInt int

	err := db.QueryRow(`
		SELECT id, username, name, profile_image, COALESCE(account_info_json, ''), total_media, last_fetched, COALESCE(response_json, ''),
		       COALESCE(media_type, 'all'), COALESCE(timeline_type, 'timeline'),
		       COALESCE(retweets, 0), COALESCE(query_key, ''), COALESCE(cursor, ''),
		       COALESCE(completed, 1), COALESCE(followers_count, 0), COALESCE(statuses_count, 0),
		       fetch_key, COALESCE(storage_version, 1)
		FROM accounts
		WHERE id = ?
	`, id).Scan(
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
	)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}

	summary.LastFetched = lastFetched
	summary.Retweets = retweetsInt == 1
	summary.Completed = completedInt == 1
	return &summary, nil
}

func ensureSummaryMigrated(summary *accountSummaryRecord) error {
	if summary == nil || summary.StorageVersion >= 2 {
		return nil
	}

	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	accountInfo := AccountInfo{
		Name:           summary.Username,
		Nick:           summary.Name,
		ProfileImage:   summary.ProfileImage,
		FollowersCount: summary.FollowersCount,
		StatusesCount:  summary.StatusesCount,
	}
	totalMedia := summary.TotalMedia
	cursor := summary.Cursor
	completed := summary.Completed
	var timeline []TimelineEntry

	if strings.TrimSpace(summary.ResponseJSON) != "" {
		convertedJSON, err := ConvertLegacyToNewFormat(summary.ResponseJSON)
		if err != nil {
			return err
		}

		var response TwitterResponse
		if err := json.Unmarshal([]byte(convertedJSON), &response); err != nil {
			return err
		}

		if response.AccountInfo.Name != "" {
			accountInfo = response.AccountInfo
		}
		if response.TotalURLs > 0 {
			totalMedia = response.TotalURLs
		} else if len(response.Timeline) > 0 {
			totalMedia = len(response.Timeline)
		}
		if response.Cursor != "" {
			cursor = response.Cursor
		} else if response.Metadata.Cursor != "" {
			cursor = response.Metadata.Cursor
		}
		completed = response.Completed || response.Metadata.Completed || summary.Completed
		timeline = response.Timeline
	}

	if err := saveAccountSnapshotChunkTx(tx, FetchScopeRecord{
		Username:     summary.Username,
		MediaType:    summary.MediaType,
		TimelineType: summary.TimelineType,
		Retweets:     summary.Retweets,
		QueryKey:     summary.QueryKey,
	}, accountInfo, timeline, cursor, completed, totalMedia, summary.LastFetched); err != nil {
		return err
	}

	if err := tx.Commit(); err != nil {
		return err
	}

	summary.StorageVersion = 2
	summary.Cursor = cursor
	summary.Completed = completed
	summary.TotalMedia = totalMedia
	summary.Name = accountInfo.Nick
	summary.ProfileImage = accountInfo.ProfileImage
	summary.FollowersCount = accountInfo.FollowersCount
	summary.StatusesCount = accountInfo.StatusesCount
	accountInfoJSON, err := json.Marshal(accountInfo)
	if err == nil {
		summary.AccountInfoJSON = string(accountInfoJSON)
	}
	return nil
}

func loadTimelineEntriesByFetchKey(fetchKey string) ([]TimelineEntry, error) {
	rows, err := db.Query(`
		SELECT entry_json
		FROM account_timeline_items
		WHERE fetch_key = ?
		ORDER BY date_unix_ms DESC, tweet_id_num DESC, entry_key ASC
	`, fetchKey)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	timeline := make([]TimelineEntry, 0)
	for rows.Next() {
		var entryJSON string
		if err := rows.Scan(&entryJSON); err != nil {
			return nil, err
		}

		var entry TimelineEntry
		if err := json.Unmarshal([]byte(entryJSON), &entry); err != nil {
			continue
		}
		timeline = append(timeline, entry)
	}

	if err := rows.Err(); err != nil {
		return nil, err
	}

	return timeline, nil
}

func buildStructuredResponse(summary *accountSummaryRecord, timeline []TimelineEntry) *TwitterResponse {
	if summary == nil {
		return nil
	}

	accountInfo := AccountInfo{
		Name:           summary.Username,
		Nick:           summary.Name,
		ProfileImage:   summary.ProfileImage,
		FollowersCount: summary.FollowersCount,
		StatusesCount:  summary.StatusesCount,
	}
	if strings.TrimSpace(summary.AccountInfoJSON) != "" {
		var decoded AccountInfo
		if err := json.Unmarshal([]byte(summary.AccountInfoJSON), &decoded); err == nil {
			if decoded.Name == "" {
				decoded.Name = accountInfo.Name
			}
			if decoded.Nick == "" {
				decoded.Nick = accountInfo.Nick
			}
			if decoded.ProfileImage == "" {
				decoded.ProfileImage = accountInfo.ProfileImage
			}
			if decoded.FollowersCount == 0 {
				decoded.FollowersCount = accountInfo.FollowersCount
			}
			if decoded.StatusesCount == 0 {
				decoded.StatusesCount = accountInfo.StatusesCount
			}
			accountInfo = decoded
		}
	}

	totalURLs := summary.TotalMedia
	if totalURLs == 0 && len(timeline) > 0 {
		totalURLs = len(timeline)
	}

	return &TwitterResponse{
		AccountInfo: accountInfo,
		TotalURLs: totalURLs,
		Timeline:  timeline,
		Metadata: ExtractMetadata{
			NewEntries: 0,
			Page:       0,
			BatchSize:  0,
			HasMore:    !summary.Completed,
			Cursor:     summary.Cursor,
			Completed:  summary.Completed,
		},
		Cursor:    summary.Cursor,
		Completed: summary.Completed,
	}
}

func GetAccountResponseByScopeStructured(username, mediaType, timelineType string, retweets bool, queryKey string) (*TwitterResponse, error) {
	if db == nil {
		if err := InitDB(); err != nil {
			return nil, err
		}
	}

	summary, err := getAccountSummaryByFetchKey(buildFetchKey(username, mediaType, timelineType, retweets, queryKey))
	if err != nil || summary == nil {
		return nil, err
	}

	if err := ensureSummaryMigrated(summary); err != nil {
		return nil, err
	}

	timeline, err := loadTimelineEntriesByFetchKey(summary.FetchKey)
	if err != nil {
		return nil, err
	}

	return buildStructuredResponse(summary, timeline), nil
}

func buildAccountDBFromSummary(summary *accountSummaryRecord) (*AccountDB, error) {
	if summary == nil {
		return nil, sql.ErrNoRows
	}

	if err := ensureSummaryMigrated(summary); err != nil {
		return nil, err
	}

	timeline, err := loadTimelineEntriesByFetchKey(summary.FetchKey)
	if err != nil {
		return nil, err
	}

	response := buildStructuredResponse(summary, timeline)
	responseJSON := ""
	if response != nil {
		responseBytes, err := json.Marshal(response)
		if err != nil {
			return nil, err
		}
		responseJSON = string(responseBytes)
	}

	return &AccountDB{
		ID:             summary.ID,
		Username:       summary.Username,
		Name:           summary.Name,
		ProfileImage:   summary.ProfileImage,
		TotalMedia:     summary.TotalMedia,
		LastFetched:    summary.LastFetched,
		ResponseJSON:   responseJSON,
		MediaType:      summary.MediaType,
		TimelineType:   summary.TimelineType,
		Retweets:       summary.Retweets,
		QueryKey:       summary.QueryKey,
		Cursor:         summary.Cursor,
		Completed:      summary.Completed,
		FollowersCount: summary.FollowersCount,
		StatusesCount:  summary.StatusesCount,
	}, nil
}

func LoadScopeMediaDownloadPayload(scope FetchScopeRecord) (*ScopeMediaDownloadPayload, error) {
	normalizedScope := normalizeFetchScopeRecord(scope)
	response, err := GetAccountResponseByScopeStructured(
		normalizedScope.Username,
		normalizedScope.MediaType,
		normalizedScope.TimelineType,
		normalizedScope.Retweets,
		normalizedScope.QueryKey,
	)
	if err != nil || response == nil {
		return nil, err
	}

	items := make([]MediaItem, 0, len(response.Timeline))
	fallbackUsername := strings.TrimSpace(response.AccountInfo.Name)
	for _, entry := range response.Timeline {
		items = append(items, MediaItem{
			URL:              entry.URL,
			Date:             entry.Date,
			TweetID:          int64(entry.TweetID),
			Type:             entry.Type,
			Username:         entry.AuthorUsername,
			Content:          entry.Content,
			OriginalFilename: entry.OriginalFilename,
		})
	}

	rootSubdirectory := ""
	switch normalizedScope.Username {
	case "bookmarks":
		rootSubdirectory = "My Bookmarks"
	case "likes":
		rootSubdirectory = "My Likes"
	}

	return &ScopeMediaDownloadPayload{
		Scope:            normalizedScope,
		Username:         fallbackUsername,
		RootSubdirectory: rootSubdirectory,
		Items:            items,
	}, nil
}
