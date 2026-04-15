package backend

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	_ "github.com/mattn/go-sqlite3"
)

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
		if err := ensureDownloadMediaIndexSchema(); err != nil {
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

	if err := ensureDownloadMediaIndexSchema(); err != nil {
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
		`CREATE INDEX IF NOT EXISTS idx_accounts_saved_view_last_fetched
			ON accounts(` + savedAccountsIsPrivateExpr + `, last_fetched DESC, id DESC)`,
		`CREATE INDEX IF NOT EXISTS idx_accounts_saved_filters_last_fetched
			ON accounts(` + savedAccountsIsPrivateExpr + `, ` + savedAccountsGroupExpr + `, ` + savedAccountsMediaTypeExpr + `, last_fetched DESC, id DESC)`,
		`CREATE INDEX IF NOT EXISTS idx_accounts_saved_filters_followers
			ON accounts(` + savedAccountsIsPrivateExpr + `, ` + savedAccountsGroupExpr + `, ` + savedAccountsMediaTypeExpr + `, ` + savedAccountsFollowersExpr + ` DESC, id DESC)`,
		`CREATE INDEX IF NOT EXISTS idx_accounts_saved_filters_statuses
			ON accounts(` + savedAccountsIsPrivateExpr + `, ` + savedAccountsGroupExpr + `, ` + savedAccountsMediaTypeExpr + `, ` + savedAccountsStatusesExpr + ` DESC, id DESC)`,
		`CREATE INDEX IF NOT EXISTS idx_accounts_saved_filters_matching_ids
			ON accounts(` + savedAccountsIsPrivateExpr + `, ` + savedAccountsGroupExpr + `, ` + savedAccountsMediaTypeExpr + `, id ASC)`,
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

	dir := filepath.Dir(dbPath)
	if err := os.MkdirAll(dir, 0o700); err != nil {
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
		_ = db.Close()
		db = nil
	}
}
