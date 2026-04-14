package backend

import (
	"database/sql"
	"fmt"
	"strings"
	"testing"
	"time"
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

func seedSavedAccountsBenchmarkData(b *testing.B, rowCount int) {
	b.Helper()

	if err := ensureAccountsSchema(); err != nil {
		b.Fatalf("ensure schema: %v", err)
	}

	tx, err := db.Begin()
	if err != nil {
		b.Fatalf("begin seed transaction: %v", err)
	}

	stmt, err := tx.Prepare(`
		INSERT INTO accounts (
			username, name, profile_image, total_media, last_fetched, response_json, account_info_json,
			group_name, group_color, media_type, timeline_type, retweets, query_key,
			followers_count, statuses_count, fetch_key, cursor, completed, storage_version
		)
		VALUES (?, ?, '', ?, ?, '{}', '{}', ?, ?, ?, ?, ?, ?, ?, ?, ?, '', 1, 1)
	`)
	if err != nil {
		_ = tx.Rollback()
		b.Fatalf("prepare seed statement: %v", err)
	}

	groupValues := []struct {
		name  string
		color string
	}{
		{"", ""},
		{"artists", "#f97316"},
		{"news", "#3b82f6"},
	}
	mediaTypes := []string{"all", "image", "video"}
	baseTime := time.Date(2026, 4, 15, 9, 0, 0, 0, time.UTC)

	for index := 0; index < rowCount; index++ {
		isPrivate := index%12 == 0
		username := fmt.Sprintf("bench_user_%05d", index)
		mediaType := mediaTypes[index%len(mediaTypes)]
		timelineType := "media"
		retweets := 0
		queryKey := ""
		group := groupValues[index%len(groupValues)]

		if isPrivate {
			if index%24 == 0 {
				username = "bookmarks"
				timelineType = "bookmarks"
			} else {
				username = "likes"
				timelineType = "likes"
			}
			mediaType = "all"
			group = groupValues[0]
			queryKey = fmt.Sprintf("private-%05d", index)
		}

		fetchKey := buildFetchKey(username, mediaType, timelineType, retweets == 1, queryKey)
		if _, err := stmt.Exec(
			username,
			fmt.Sprintf("Benchmark User %05d", index),
			200+(index%50),
			baseTime.Add(-time.Duration(index)*time.Minute),
			group.name,
			group.color,
			mediaType,
			timelineType,
			retweets,
			queryKey,
			1000+(index%5000),
			2000+(index%8000),
			fetchKey,
		); err != nil {
			_ = stmt.Close()
			_ = tx.Rollback()
			b.Fatalf("seed row %d: %v", index, err)
		}
	}

	if err := stmt.Close(); err != nil {
		_ = tx.Rollback()
		b.Fatalf("close seed statement: %v", err)
	}
	if _, err := tx.Exec(`ANALYZE`); err != nil {
		_ = tx.Rollback()
		b.Fatalf("analyze seed db: %v", err)
	}
	if err := tx.Commit(); err != nil {
		b.Fatalf("commit seed transaction: %v", err)
	}
}

func BenchmarkGetSavedAccountsQueryPage(b *testing.B) {
	withBenchmarkDB(b, func() {
		seedSavedAccountsBenchmarkData(b, 5000)

		cases := []struct {
			name            string
			accountViewMode string
			searchQuery     string
			filterGroup     string
			filterMediaType string
			sortOrder       string
		}{
			{
				name:            "public/newest/default-filters",
				accountViewMode: "public",
				filterGroup:     "all",
				filterMediaType: "all-media",
				sortOrder:       "newest",
			},
			{
				name:            "public/followers-high/filtered",
				accountViewMode: "public",
				filterGroup:     "artists",
				filterMediaType: "image",
				sortOrder:       "followers-high",
			},
			{
				name:            "public/posts-high/filtered-search",
				accountViewMode: "public",
				searchQuery:     "benchmark",
				filterGroup:     "news",
				filterMediaType: "video",
				sortOrder:       "posts-high",
			},
			{
				name:            "private/newest",
				accountViewMode: "private",
				sortOrder:       "newest",
			},
		}

		for _, benchCase := range cases {
			benchCase := benchCase
			b.Run(benchCase.name, func(b *testing.B) {
				b.ResetTimer()
				for i := 0; i < b.N; i++ {
					page, err := GetSavedAccountsQueryPage(
						benchCase.accountViewMode,
						benchCase.searchQuery,
						benchCase.filterGroup,
						benchCase.filterMediaType,
						benchCase.sortOrder,
						0,
						100,
					)
					if err != nil {
						b.Fatalf("GetSavedAccountsQueryPage failed: %v", err)
					}
					if page == nil || len(page.Items) == 0 {
						b.Fatal("expected non-empty saved accounts page")
					}
				}
			})
		}
	})
}

func BenchmarkGetSavedAccountMatchingIDs(b *testing.B) {
	withBenchmarkDB(b, func() {
		seedSavedAccountsBenchmarkData(b, 5000)

		cases := []struct {
			name            string
			accountViewMode string
			searchQuery     string
			filterGroup     string
			filterMediaType string
		}{
			{
				name:            "public/default-filters",
				accountViewMode: "public",
				filterGroup:     "all",
				filterMediaType: "all-media",
			},
			{
				name:            "public/filtered",
				accountViewMode: "public",
				filterGroup:     "artists",
				filterMediaType: "image",
			},
			{
				name:            "public/search",
				accountViewMode: "public",
				searchQuery:     "benchmark",
				filterGroup:     "news",
				filterMediaType: "video",
			},
			{
				name:            "private",
				accountViewMode: "private",
			},
		}

		for _, benchCase := range cases {
			benchCase := benchCase
			b.Run(benchCase.name, func(b *testing.B) {
				b.ResetTimer()
				for i := 0; i < b.N; i++ {
					ids, err := GetSavedAccountMatchingIDs(
						benchCase.accountViewMode,
						benchCase.searchQuery,
						benchCase.filterGroup,
						benchCase.filterMediaType,
					)
					if err != nil {
						b.Fatalf("GetSavedAccountMatchingIDs failed: %v", err)
					}
					if len(ids) == 0 {
						b.Fatal("expected non-empty matching ids")
					}
				}
			})
		}
	})
}
