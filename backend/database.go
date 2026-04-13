package backend

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	_ "github.com/mattn/go-sqlite3"
)

// AccountDB represents a saved account in the database
type AccountDB struct {
	ID             int64     `json:"id"`
	Username       string    `json:"username"`
	Name           string    `json:"name"`
	ProfileImage   string    `json:"profile_image"`
	TotalMedia     int       `json:"total_media"`
	LastFetched    time.Time `json:"last_fetched"`
	ResponseJSON   string    `json:"response_json"`
	MediaType      string    `json:"media_type"`
	TimelineType   string    `json:"timeline_type"`
	Retweets       bool      `json:"retweets"`
	QueryKey       string    `json:"query_key"`
	Cursor         string    `json:"cursor"`
	Completed      bool      `json:"completed"`
	FollowersCount int       `json:"followers_count"`
	StatusesCount  int       `json:"statuses_count"`
}

// AccountListItem represents a simplified account for listing
type AccountListItem struct {
	ID             int64  `json:"id"`
	Username       string `json:"username"`
	Name           string `json:"name"`
	ProfileImage   string `json:"profile_image"`
	TotalMedia     int    `json:"total_media"`
	LastFetched    string `json:"last_fetched"`
	GroupName      string `json:"group_name"`
	GroupColor     string `json:"group_color"`
	MediaType      string `json:"media_type"`
	TimelineType   string `json:"timeline_type"`
	Retweets       bool   `json:"retweets"`
	QueryKey       string `json:"query_key"`
	Cursor         string `json:"cursor"`
	Completed      bool   `json:"completed"`
	FollowersCount int    `json:"followers_count"`
	StatusesCount  int    `json:"statuses_count"`
}

var db *sql.DB

const accountsTableSchema = `
	CREATE TABLE IF NOT EXISTS accounts (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		username TEXT NOT NULL,
		name TEXT,
		profile_image TEXT,
		total_media INTEGER DEFAULT 0,
		last_fetched DATETIME,
		response_json TEXT,
		account_info_json TEXT DEFAULT '',
		group_name TEXT DEFAULT '',
		group_color TEXT DEFAULT '',
		media_type TEXT DEFAULT 'all',
		timeline_type TEXT DEFAULT 'timeline',
		retweets INTEGER DEFAULT 0,
		query_key TEXT DEFAULT '',
		followers_count INTEGER DEFAULT 0,
		statuses_count INTEGER DEFAULT 0,
		fetch_key TEXT NOT NULL UNIQUE,
		cursor TEXT DEFAULT '',
		completed INTEGER DEFAULT 1,
		storage_version INTEGER DEFAULT 1
	)
`

// GetDBPath returns the database file path
func GetDBPath() string {
	homeDir, err := os.UserHomeDir()
	if err != nil {
		homeDir = "."
	}
	return filepath.Join(homeDir, ".twitterxmediabatchdownloader", "accounts.db")
}

func buildFetchKey(username, mediaType, timelineType string, retweets bool, queryKey string) string {
	normalizedUsername := strings.ToLower(strings.TrimSpace(username))
	normalizedMediaType := strings.TrimSpace(mediaType)
	if normalizedMediaType == "" {
		normalizedMediaType = "all"
	}
	normalizedTimelineType := strings.TrimSpace(timelineType)
	if normalizedTimelineType == "" {
		normalizedTimelineType = "timeline"
	}
	normalizedQueryKey := strings.TrimSpace(queryKey)
	retweetsFlag := "0"
	if retweets {
		retweetsFlag = "1"
	}

	return strings.Join([]string{
		normalizedUsername,
		normalizedMediaType,
		normalizedTimelineType,
		retweetsFlag,
		normalizedQueryKey,
	}, "|")
}

func sanitizeFilenamePart(value string) string {
	replacer := strings.NewReplacer(
		"/", "-",
		"\\", "-",
		":", "-",
		"?", "",
		"*", "",
		"\"", "",
		"<", "",
		">", "",
		"|", "",
		" ", "_",
	)
	sanitized := replacer.Replace(strings.TrimSpace(value))
	if sanitized == "" {
		return ""
	}
	return sanitized
}

func accountsTableExists() (bool, error) {
	var name string
	err := db.QueryRow(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'accounts'`).Scan(&name)
	if err == sql.ErrNoRows {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	return true, nil
}

func getAccountsTableColumns() (map[string]bool, error) {
	rows, err := db.Query(`PRAGMA table_info(accounts)`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	columns := make(map[string]bool)
	for rows.Next() {
		var cid int
		var name string
		var columnType string
		var notNull int
		var defaultValue interface{}
		var primaryKey int
		if err := rows.Scan(&cid, &name, &columnType, &notNull, &defaultValue, &primaryKey); err != nil {
			return nil, err
		}
		columns[name] = true
	}

	return columns, rows.Err()
}

func backfillAccountsFetchKeys() error {
	_, err := db.Exec(`
		UPDATE accounts
		SET
			media_type = COALESCE(NULLIF(media_type, ''), 'all'),
			timeline_type = COALESCE(NULLIF(timeline_type, ''), 'timeline'),
			retweets = COALESCE(retweets, 0),
			query_key = COALESCE(query_key, ''),
			fetch_key = lower(trim(username)) || '|' ||
				COALESCE(NULLIF(media_type, ''), 'all') || '|' ||
				COALESCE(NULLIF(timeline_type, ''), 'timeline') || '|' ||
				CAST(COALESCE(retweets, 0) AS TEXT) || '|' ||
				COALESCE(query_key, '')
		WHERE COALESCE(fetch_key, '') = ''
	`)
	return err
}

func ensureAccountsMetricColumns(columns map[string]bool) (bool, error) {
	added := false
	if !columns["followers_count"] {
		if _, err := db.Exec(`ALTER TABLE accounts ADD COLUMN followers_count INTEGER DEFAULT 0`); err != nil {
			return false, err
		}
		added = true
	}
	if !columns["statuses_count"] {
		if _, err := db.Exec(`ALTER TABLE accounts ADD COLUMN statuses_count INTEGER DEFAULT 0`); err != nil {
			return false, err
		}
		added = true
	}
	return added, nil
}

func extractAccountMetrics(responseJSON string) (int, int, bool) {
	if strings.TrimSpace(responseJSON) == "" {
		return 0, 0, false
	}

	convertedJSON, err := ConvertLegacyToNewFormat(responseJSON)
	if err != nil {
		return 0, 0, false
	}

	var response TwitterResponse
	if err := json.Unmarshal([]byte(convertedJSON), &response); err != nil {
		return 0, 0, false
	}

	if response.AccountInfo.Name == "" &&
		response.AccountInfo.Nick == "" &&
		response.AccountInfo.FollowersCount == 0 &&
		response.AccountInfo.StatusesCount == 0 {
		return 0, 0, false
	}

	return response.AccountInfo.FollowersCount, response.AccountInfo.StatusesCount, true
}

func backfillAccountsMetrics() error {
	rows, err := db.Query(`SELECT id, COALESCE(response_json, '') FROM accounts`)
	if err != nil {
		return err
	}

	type accountSnapshot struct {
		id           int64
		responseJSON string
	}
	var snapshots []accountSnapshot
	for rows.Next() {
		var snapshot accountSnapshot
		if err := rows.Scan(&snapshot.id, &snapshot.responseJSON); err != nil {
			rows.Close()
			return err
		}
		snapshots = append(snapshots, snapshot)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return err
	}
	if err := rows.Close(); err != nil {
		return err
	}

	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	updateStmt, err := tx.Prepare(`UPDATE accounts SET followers_count = ?, statuses_count = ? WHERE id = ?`)
	if err != nil {
		return err
	}
	defer updateStmt.Close()

	for _, snapshot := range snapshots {
		followersCount, statusesCount, ok := extractAccountMetrics(snapshot.responseJSON)
		if !ok {
			continue
		}

		if _, err := updateStmt.Exec(followersCount, statusesCount, snapshot.id); err != nil {
			return err
		}
	}

	return tx.Commit()
}

func migrateLegacyAccountsTable(columns map[string]bool) error {
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	if _, err := tx.Exec(`DROP TABLE IF EXISTS accounts_new`); err != nil {
		return err
	}
	if _, err := tx.Exec(strings.Replace(accountsTableSchema, "accounts", "accounts_new", 1)); err != nil {
		return err
	}

	groupNameExpr := "''"
	if columns["group_name"] {
		groupNameExpr = "COALESCE(group_name, '')"
	}
	groupColorExpr := "''"
	if columns["group_color"] {
		groupColorExpr = "COALESCE(group_color, '')"
	}
	mediaTypeExpr := "'all'"
	if columns["media_type"] {
		mediaTypeExpr = "COALESCE(NULLIF(media_type, ''), 'all')"
	}
	timelineTypeExpr := "'timeline'"
	if columns["timeline_type"] {
		timelineTypeExpr = "COALESCE(NULLIF(timeline_type, ''), 'timeline')"
	}
	retweetsExpr := "0"
	if columns["retweets"] {
		retweetsExpr = "COALESCE(retweets, 0)"
	}
	queryKeyExpr := "''"
	if columns["query_key"] {
		queryKeyExpr = "COALESCE(query_key, '')"
	}
	cursorExpr := "''"
	if columns["cursor"] {
		cursorExpr = "COALESCE(cursor, '')"
	}
	completedExpr := "1"
	if columns["completed"] {
		completedExpr = "COALESCE(completed, 1)"
	}
	fetchKeyExpr := fmt.Sprintf(
		"lower(trim(username)) || '|' || %s || '|' || %s || '|' || CAST(%s AS TEXT) || '|' || %s",
		mediaTypeExpr,
		timelineTypeExpr,
		retweetsExpr,
		queryKeyExpr,
	)

	insertSQL := fmt.Sprintf(`
			INSERT INTO accounts_new (
				id, username, name, profile_image, total_media, last_fetched, response_json, account_info_json,
				group_name, group_color, media_type, timeline_type, retweets, query_key,
				followers_count, statuses_count, fetch_key, cursor, completed
			)
			SELECT
				id, username, name, profile_image, total_media, last_fetched, response_json, '',
				%s, %s, %s, %s, %s, %s, 0, 0, %s, %s, %s
			FROM accounts
		`, groupNameExpr, groupColorExpr, mediaTypeExpr, timelineTypeExpr, retweetsExpr, queryKeyExpr, fetchKeyExpr, cursorExpr, completedExpr)

	if _, err := tx.Exec(insertSQL); err != nil {
		return err
	}
	if _, err := tx.Exec(`DROP TABLE accounts`); err != nil {
		return err
	}
	if _, err := tx.Exec(`ALTER TABLE accounts_new RENAME TO accounts`); err != nil {
		return err
	}

	return tx.Commit()
}

func ensureAccountsSchema() error {
	exists, err := accountsTableExists()
	if err != nil {
		return err
	}
	if !exists {
		if _, err := db.Exec(accountsTableSchema); err != nil {
			return err
		}
		if err := ensureAccountTimelineItemsSchema(); err != nil {
			return err
		}
		return ensureAccountsIndexes()
	}

	columns, err := getAccountsTableColumns()
	if err != nil {
		return err
	}

	needsMetricsBackfill := false
	if !columns["fetch_key"] || !columns["timeline_type"] || !columns["retweets"] || !columns["query_key"] {
		if err := migrateLegacyAccountsTable(columns); err != nil {
			return err
		}
		needsMetricsBackfill = true
		columns, err = getAccountsTableColumns()
		if err != nil {
			return err
		}
	}

	metricsColumnsAdded, err := ensureAccountsMetricColumns(columns)
	if err != nil {
		return err
	}
	if metricsColumnsAdded {
		needsMetricsBackfill = true
	}

	if _, err := ensureAccountsStorageColumns(columns); err != nil {
		return err
	}

	if err := backfillAccountsFetchKeys(); err != nil {
		return err
	}

	if err := ensureAccountTimelineItemsSchema(); err != nil {
		return err
	}

	if err := ensureAccountsIndexes(); err != nil {
		return err
	}

	if needsMetricsBackfill {
		return backfillAccountsMetrics()
	}

	return nil
}

func ensureAccountsIndexes() error {
	indexStatements := []string{
		`CREATE INDEX IF NOT EXISTS idx_accounts_group_last_fetched ON accounts(group_name, last_fetched DESC)`,
		`CREATE INDEX IF NOT EXISTS idx_accounts_fetch_key ON accounts(fetch_key)`,
	}

	for _, statement := range indexStatements {
		if _, err := db.Exec(statement); err != nil {
			return err
		}
	}

	return nil
}

// InitDB initializes the database connection
func InitDB() error {
	dbPath := GetDBPath()

	// Create directory if not exists
	dir := filepath.Dir(dbPath)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return err
	}

	var err error
	db, err = sql.Open("sqlite3", dbPath)
	if err != nil {
		return err
	}

	return ensureAccountsSchema()
}

// CloseDB closes the database connection
func CloseDB() {
	if db != nil {
		db.Close()
	}
}

// SaveAccount saves or updates an account in the database
func SaveAccount(username, name, profileImage string, totalMedia int, responseJSON string, mediaType string) error {
	return SaveAccountWithStatus(username, name, profileImage, totalMedia, responseJSON, mediaType, "timeline", false, "", "", true)
}

// SaveAccountWithStatus saves or updates an account with cursor and completion status
func SaveAccountWithStatus(username, name, profileImage string, totalMedia int, responseJSON string, mediaType string, timelineType string, retweets bool, queryKey string, cursor string, completed bool) error {
	if db == nil {
		if err := InitDB(); err != nil {
			return err
		}
	}

	convertedJSON, err := ConvertLegacyToNewFormat(responseJSON)
	if err != nil {
		return err
	}

	var response TwitterResponse
	if err := json.Unmarshal([]byte(convertedJSON), &response); err != nil {
		return err
	}

	if response.AccountInfo.Name == "" {
		response.AccountInfo.Name = username
	}
	if response.AccountInfo.Nick == "" {
		response.AccountInfo.Nick = name
	}
	if response.AccountInfo.ProfileImage == "" {
		response.AccountInfo.ProfileImage = profileImage
	}
	if response.TotalURLs == 0 && totalMedia > 0 {
		response.TotalURLs = totalMedia
	}
	if response.TotalURLs == 0 && len(response.Timeline) > 0 {
		response.TotalURLs = len(response.Timeline)
	}
	if response.Cursor == "" {
		response.Cursor = cursor
	}
	if response.Metadata.Cursor == "" {
		response.Metadata.Cursor = response.Cursor
	}
	response.Completed = completed
	response.Metadata.Completed = completed

	return SaveAccountResponseStructured(FetchScopeRecord{
		Username:     username,
		MediaType:    mediaType,
		TimelineType: timelineType,
		Retweets:     retweets,
		QueryKey:     queryKey,
	}, response)
}

// GetAllAccounts returns all saved accounts
func GetAllAccounts() ([]AccountListItem, error) {
	if db == nil {
		if err := InitDB(); err != nil {
			return nil, err
		}
	}

	rows, err := db.Query(`
			SELECT id, username, name, profile_image, total_media, last_fetched, 
			       COALESCE(group_name, '') as group_name, COALESCE(group_color, '') as group_color,
			       COALESCE(media_type, 'all') as media_type,
			       COALESCE(timeline_type, 'timeline') as timeline_type,
			       COALESCE(retweets, 0) as retweets,
			       COALESCE(query_key, '') as query_key,
			       COALESCE(cursor, '') as cursor, COALESCE(completed, 1) as completed,
			       COALESCE(followers_count, 0) as followers_count,
			       COALESCE(statuses_count, 0) as statuses_count
			FROM accounts
			ORDER BY group_name ASC, last_fetched DESC
		`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var accounts []AccountListItem
	for rows.Next() {
		var acc AccountListItem
		var lastFetched time.Time
		var retweetsInt int
		var completedInt int
		if err := rows.Scan(&acc.ID, &acc.Username, &acc.Name, &acc.ProfileImage, &acc.TotalMedia, &lastFetched, &acc.GroupName, &acc.GroupColor, &acc.MediaType, &acc.TimelineType, &retweetsInt, &acc.QueryKey, &acc.Cursor, &completedInt, &acc.FollowersCount, &acc.StatusesCount); err != nil {
			continue
		}
		acc.LastFetched = lastFetched.Format("2006-01-02 15:04")
		acc.Retweets = retweetsInt == 1
		acc.Completed = completedInt == 1

		accounts = append(accounts, acc)
	}

	return accounts, nil
}

// UpdateAccountGroup updates the group for an account
func UpdateAccountGroup(id int64, groupName, groupColor string) error {
	if db == nil {
		if err := InitDB(); err != nil {
			return err
		}
	}

	_, err := db.Exec("UPDATE accounts SET group_name = ?, group_color = ? WHERE id = ?", groupName, groupColor, id)
	return err
}

// GetAllGroups returns all unique groups
func GetAllGroups() ([]map[string]string, error) {
	if db == nil {
		if err := InitDB(); err != nil {
			return nil, err
		}
	}

	rows, err := db.Query(`
		SELECT DISTINCT group_name, group_color 
		FROM accounts 
		WHERE group_name != '' 
		ORDER BY group_name
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var groups []map[string]string
	for rows.Next() {
		var name, color string
		if err := rows.Scan(&name, &color); err != nil {
			continue
		}
		groups = append(groups, map[string]string{"name": name, "color": color})
	}

	return groups, nil
}

// ClearAllAccounts deletes all accounts from the database
func ClearAllAccounts() error {
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

	if _, err := tx.Exec("DELETE FROM account_timeline_items"); err != nil {
		return err
	}
	if _, err := tx.Exec("DELETE FROM accounts"); err != nil {
		return err
	}

	return tx.Commit()
}

// GetAccountByID returns a specific account by ID
func GetAccountByID(id int64) (*AccountDB, error) {
	if db == nil {
		if err := InitDB(); err != nil {
			return nil, err
		}
	}

	summary, err := getAccountSummaryByID(id)
	if err != nil {
		return nil, err
	}
	if summary == nil {
		return nil, sql.ErrNoRows
	}

	return buildAccountDBFromSummary(summary)
}

// GetAccountResponseByScope returns the saved snapshot JSON for an exact fetch scope.
func GetAccountResponseByScope(username, mediaType, timelineType string, retweets bool, queryKey string) (string, error) {
	response, err := GetAccountResponseByScopeStructured(username, mediaType, timelineType, retweets, queryKey)
	if err != nil || response == nil {
		return "", err
	}

	responseJSON, err := json.Marshal(response)
	if err != nil {
		return "", err
	}

	return string(responseJSON), nil
}

// DeleteAccount deletes an account from the database
func DeleteAccount(id int64) error {
	if db == nil {
		if err := InitDB(); err != nil {
			return err
		}
	}

	summary, err := getAccountSummaryByID(id)
	if err != nil {
		return err
	}
	if summary == nil {
		return nil
	}

	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	if _, err := tx.Exec("DELETE FROM account_timeline_items WHERE fetch_key = ?", summary.FetchKey); err != nil {
		return err
	}
	if _, err := tx.Exec("DELETE FROM accounts WHERE id = ?", id); err != nil {
		return err
	}

	return tx.Commit()
}

// LegacyMediaEntry represents media entry in old format
type LegacyMediaEntry struct {
	TweetID string `json:"tweet_id"`
	URL     string `json:"url"`
	Date    string `json:"date"`
	Type    string `json:"type"`
}

// LegacyAccountFormat represents the old saved account format
type LegacyAccountFormat struct {
	Username       string             `json:"username"`
	Nick           string             `json:"nick"`
	Followers      int                `json:"followers"`
	Following      int                `json:"following"`
	Posts          int                `json:"posts"`
	MediaType      string             `json:"media_type"`
	ProfileImage   string             `json:"profile_image"`
	FetchMode      string             `json:"fetch_mode"`
	FetchTimestamp string             `json:"fetch_timestamp"`
	GroupID        interface{}        `json:"group_id"`
	MediaList      []LegacyMediaEntry `json:"media_list"`
}

// ConvertLegacyToNewFormat converts old format to new TwitterResponse format
func ConvertLegacyToNewFormat(jsonStr string) (string, error) {
	// First check if it's already in new format (has account_info key)
	var check map[string]interface{}
	if err := json.Unmarshal([]byte(jsonStr), &check); err != nil {
		return jsonStr, err
	}

	// If already has account_info, it's new format - return as is
	if _, hasAccountInfo := check["account_info"]; hasAccountInfo {
		return jsonStr, nil
	}

	// Check if it's legacy format (has username and media_list)
	if _, hasUsername := check["username"]; !hasUsername {
		return jsonStr, nil
	}
	if _, hasMediaList := check["media_list"]; !hasMediaList {
		return jsonStr, nil
	}

	// Parse as legacy format
	var legacy LegacyAccountFormat
	if err := json.Unmarshal([]byte(jsonStr), &legacy); err != nil {
		return jsonStr, err
	}

	// Convert timeline entries
	timeline := make([]map[string]interface{}, len(legacy.MediaList))
	for i, media := range legacy.MediaList {
		timeline[i] = map[string]interface{}{
			"url":        media.URL,
			"date":       media.Date,
			"tweet_id":   media.TweetID,
			"type":       media.Type,
			"is_retweet": false,
		}
	}

	// Build new format
	newFormat := map[string]interface{}{
		"account_info": map[string]interface{}{
			"name":            legacy.Username,
			"nick":            legacy.Nick,
			"date":            "",
			"followers_count": legacy.Followers,
			"friends_count":   legacy.Following,
			"profile_image":   legacy.ProfileImage,
			"statuses_count":  legacy.Posts,
		},
		"total_urls": len(legacy.MediaList),
		"timeline":   timeline,
		"metadata": map[string]interface{}{
			"new_entries": len(legacy.MediaList),
			"page":        0,
			"batch_size":  0,
			"has_more":    false,
		},
	}

	// Convert back to JSON
	newJSON, err := json.Marshal(newFormat)
	if err != nil {
		return jsonStr, err
	}

	return string(newJSON), nil
}

// ExportAccountToFile exports account JSON to a file
func ExportAccountToFile(id int64, outputDir string) (string, error) {
	acc, err := GetAccountByID(id)
	if err != nil {
		return "", err
	}

	// Create export directory if not exists
	exportDir := filepath.Join(outputDir, "twitterxmediabatchdownloader_backups")
	if err := os.MkdirAll(exportDir, 0755); err != nil {
		return "", err
	}

	// Use username (nick) for filename
	filename := acc.Username
	if filename == "" {
		filename = acc.Name
	}
	filenameParts := []string{sanitizeFilenamePart(filename)}
	if mediaType := sanitizeFilenamePart(acc.MediaType); mediaType != "" {
		filenameParts = append(filenameParts, mediaType)
	}
	if timelineType := sanitizeFilenamePart(acc.TimelineType); timelineType != "" {
		filenameParts = append(filenameParts, timelineType)
	}
	if acc.Retweets {
		filenameParts = append(filenameParts, "retweets")
	}
	if queryKey := sanitizeFilenamePart(acc.QueryKey); queryKey != "" {
		filenameParts = append(filenameParts, queryKey)
	}
	filename = strings.Join(filenameParts, "_")

	filePath := filepath.Join(exportDir, filename+".json")

	if err := os.WriteFile(filePath, []byte(acc.ResponseJSON), 0644); err != nil {
		return "", err
	}

	return filePath, nil
}

// ExportAccountsToTXT exports selected accounts to TXT file (one username per line)
func ExportAccountsToTXT(ids []int64, outputDir string) (string, error) {
	if len(ids) == 0 {
		return "", fmt.Errorf("no accounts to export")
	}

	// Create export directory if not exists
	exportDir := filepath.Join(outputDir, "twitterxmediabatchdownloader_backups")
	if err := os.MkdirAll(exportDir, 0755); err != nil {
		return "", err
	}

	// Get all accounts by IDs
	var usernames []string
	for _, id := range ids {
		acc, err := GetAccountByID(id)
		if err != nil {
			continue // Skip if account not found
		}
		if acc.Username != "" {
			usernames = append(usernames, acc.Username)
		}
	}

	if len(usernames) == 0 {
		return "", fmt.Errorf("no valid usernames found")
	}

	// Create TXT content (one username per line)
	txtContent := ""
	for i, username := range usernames {
		if i > 0 {
			txtContent += "\n"
		}
		txtContent += username
	}

	// Filename: twitterxmediabatchdownloader_multiple.txt
	filePath := filepath.Join(exportDir, "twitterxmediabatchdownloader_multiple.txt")

	if err := os.WriteFile(filePath, []byte(txtContent), 0644); err != nil {
		return "", err
	}

	return filePath, nil
}

// ImportAccountFromFile imports account from JSON file (supports both old and new format)
func ImportAccountFromFile(filePath string) (string, error) {
	if db == nil {
		if err := InitDB(); err != nil {
			return "", err
		}
	}

	// Read file
	data, err := os.ReadFile(filePath)
	if err != nil {
		return "", err
	}

	jsonStr := string(data)

	// Convert legacy format if needed
	convertedJSON, err := ConvertLegacyToNewFormat(jsonStr)
	if err != nil {
		return "", err
	}

	// Parse the converted JSON to extract account info
	var parsed map[string]interface{}
	if err := json.Unmarshal([]byte(convertedJSON), &parsed); err != nil {
		return "", err
	}

	// Extract account info
	accountInfo, ok := parsed["account_info"].(map[string]interface{})
	if !ok {
		return "", fmt.Errorf("invalid JSON format: missing account_info")
	}

	username, _ := accountInfo["name"].(string)
	name, _ := accountInfo["nick"].(string)
	profileImage, _ := accountInfo["profile_image"].(string)

	totalURLs := 0
	if total, ok := parsed["total_urls"].(float64); ok {
		totalURLs = int(total)
	}

	if username == "" {
		return "", fmt.Errorf("invalid JSON format: missing username")
	}

	// Save to database with default media type "all" for imported files
	err = SaveAccount(username, name, profileImage, totalURLs, convertedJSON, "all")
	if err != nil {
		return "", err
	}

	return username, nil
}
