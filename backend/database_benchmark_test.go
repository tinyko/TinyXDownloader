package backend

import (
	"database/sql"
	"fmt"
	"strings"
	"testing"
)

func withBenchmarkDB(b *testing.B, fn func()) {
	b.Helper()

	previousDB := db
	testDB, err := sql.Open("sqlite3", ":memory:")
	if err != nil {
		b.Fatalf("open benchmark db: %v", err)
	}
	testDB.SetMaxOpenConns(1)
	db = testDB

	defer func() {
		if db != nil {
			_ = db.Close()
		}
		db = previousDB
	}()

	fn()
}

func BenchmarkGetAllAccounts500Rows(b *testing.B) {
	withBenchmarkDB(b, func() {
		if err := ensureAccountsSchema(); err != nil {
			b.Fatalf("ensure schema: %v", err)
		}

		largePayload := fmt.Sprintf(
			`{"account_info":{"name":"seed","nick":"Seed","followers_count":1234,"statuses_count":5678},"timeline":[{"content":"%s"}],"metadata":{"has_more":false}}`,
			strings.Repeat("x", 4096),
		)

		tx, err := db.Begin()
		if err != nil {
			b.Fatalf("begin insert transaction: %v", err)
		}

		stmt, err := tx.Prepare(`
			INSERT INTO accounts (
				username, name, profile_image, total_media, last_fetched, response_json,
				group_name, group_color, media_type, timeline_type, retweets, query_key,
				followers_count, statuses_count, fetch_key, cursor, completed
			)
			VALUES (?, ?, ?, ?, datetime('now'), ?, '', '', 'all', 'media', 0, '', ?, ?, ?, '', 1)
		`)
		if err != nil {
			b.Fatalf("prepare insert statement: %v", err)
		}

		for index := 0; index < 500; index++ {
			username := fmt.Sprintf("bench_user_%03d", index)
			if _, err := stmt.Exec(
				username,
				fmt.Sprintf("Bench User %03d", index),
				"",
				200+index,
				largePayload,
				1000+index,
				2000+index,
				buildFetchKey(username, "all", "media", false, ""),
			); err != nil {
				_ = stmt.Close()
				_ = tx.Rollback()
				b.Fatalf("insert row %d: %v", index, err)
			}
		}

		if err := stmt.Close(); err != nil {
			_ = tx.Rollback()
			b.Fatalf("close insert statement: %v", err)
		}
		if err := tx.Commit(); err != nil {
			b.Fatalf("commit seed transaction: %v", err)
		}

		b.ResetTimer()
		for i := 0; i < b.N; i++ {
			accounts, err := GetAllAccounts()
			if err != nil {
				b.Fatalf("GetAllAccounts failed: %v", err)
			}
			if len(accounts) != 500 {
				b.Fatalf("expected 500 accounts, got %d", len(accounts))
			}
		}
	})
}
