package backend

import "fmt"

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
	if err := ensureAccountTimelineItemsProjectionColumns(); err != nil {
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

func getTableColumns(table string) (map[string]bool, error) {
	rows, err := db.Query(fmt.Sprintf(`PRAGMA table_info(%s)`, table))
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

func ensureAccountTimelineItemsProjectionColumns() error {
	columns, err := getTableColumns("account_timeline_items")
	if err != nil {
		return err
	}

	type columnSpec struct {
		name string
		sql  string
	}

	requiredColumns := []columnSpec{
		{name: "content", sql: `ALTER TABLE account_timeline_items ADD COLUMN content TEXT`},
		{name: "author_username", sql: `ALTER TABLE account_timeline_items ADD COLUMN author_username TEXT`},
		{name: "original_filename", sql: `ALTER TABLE account_timeline_items ADD COLUMN original_filename TEXT`},
	}

	for _, column := range requiredColumns {
		if columns[column.name] {
			continue
		}
		if _, err := db.Exec(column.sql); err != nil {
			return err
		}
	}

	return nil
}
