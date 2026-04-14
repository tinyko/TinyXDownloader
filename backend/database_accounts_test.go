package backend

import (
	"encoding/json"
	"testing"
)

func TestBuildFetchKeyUsesAllDimensions(t *testing.T) {
	base := buildFetchKey(" TaroJob ", "all", "timeline", false, "")
	same := buildFetchKey("tarojob", "all", "timeline", false, "")
	if base != same {
		t.Fatalf("expected normalized keys to match, got %q and %q", base, same)
	}

	withRetweets := buildFetchKey("tarojob", "all", "timeline", true, "")
	if base == withRetweets {
		t.Fatalf("expected retweets to affect fetch key, got %q", withRetweets)
	}

	withQueryKey := buildFetchKey("tarojob", "all", "date_range", false, "2026-04-01:2026-04-10")
	if base == withQueryKey {
		t.Fatalf("expected query key to affect fetch key, got %q", withQueryKey)
	}
}

func TestBuildFetchKeyAppliesDefaults(t *testing.T) {
	key := buildFetchKey("tarojob", "", "", false, "")
	if key != "tarojob|all|timeline|0|" {
		t.Fatalf("unexpected default fetch key: %q", key)
	}
}

func TestEnsureAccountsSchemaBackfillsMetrics(t *testing.T) {
	withTestDB(t, func() {
		_, err := db.Exec(`
			CREATE TABLE accounts (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				username TEXT NOT NULL,
				name TEXT,
				profile_image TEXT,
				total_media INTEGER DEFAULT 0,
				last_fetched DATETIME,
				response_json TEXT,
				group_name TEXT DEFAULT '',
				group_color TEXT DEFAULT '',
				media_type TEXT DEFAULT 'all',
				timeline_type TEXT DEFAULT 'timeline',
				retweets INTEGER DEFAULT 0,
				query_key TEXT DEFAULT '',
				fetch_key TEXT NOT NULL UNIQUE,
				cursor TEXT DEFAULT '',
				completed INTEGER DEFAULT 1
			)
		`)
		if err != nil {
			t.Fatalf("create legacy accounts table: %v", err)
		}

		responseJSONBytes, err := json.Marshal(TwitterResponse{
			AccountInfo: AccountInfo{
				Name:           "tarojob",
				Nick:           "Taro",
				FollowersCount: 321,
				StatusesCount:  654,
			},
			TotalURLs: 1,
			Timeline:  []TimelineEntry{},
			Metadata:  ExtractMetadata{},
		})
		if err != nil {
			t.Fatalf("marshal response: %v", err)
		}

		_, err = db.Exec(`
			INSERT INTO accounts (
				username, name, profile_image, total_media, last_fetched, response_json,
				group_name, group_color, media_type, timeline_type, retweets, query_key, fetch_key, cursor, completed
			)
			VALUES (?, ?, ?, ?, datetime('now'), ?, '', '', 'all', 'media', 0, '', ?, '', 0)
		`, "tarojob", "Taro", "", 1, string(responseJSONBytes), buildFetchKey("tarojob", "all", "media", false, ""))
		if err != nil {
			t.Fatalf("insert legacy row: %v", err)
		}

		if err := ensureAccountsSchema(); err != nil {
			t.Fatalf("ensure schema: %v", err)
		}

		columns, err := getAccountsTableColumns()
		if err != nil {
			t.Fatalf("get columns: %v", err)
		}
		if !columns["followers_count"] || !columns["statuses_count"] {
			t.Fatalf("expected metrics columns to exist, got %+v", columns)
		}

		var followersCount int
		var statusesCount int
		err = db.QueryRow(`
			SELECT followers_count, statuses_count
			FROM accounts
			WHERE username = ?
		`, "tarojob").Scan(&followersCount, &statusesCount)
		if err != nil {
			t.Fatalf("query metrics: %v", err)
		}

		if followersCount != 321 || statusesCount != 654 {
			t.Fatalf("expected backfilled metrics 321/654, got %d/%d", followersCount, statusesCount)
		}
	})
}

func TestGetAllAccountsUsesStoredMetricsColumns(t *testing.T) {
	withTestDB(t, func() {
		if _, err := db.Exec(accountsTableSchema); err != nil {
			t.Fatalf("create accounts table: %v", err)
		}

		_, err := db.Exec(`
			INSERT INTO accounts (
				username, name, profile_image, total_media, last_fetched, response_json,
				group_name, group_color, media_type, timeline_type, retweets, query_key,
				followers_count, statuses_count, fetch_key, cursor, completed
			)
			VALUES (?, ?, ?, ?, datetime('now'), ?, '', '', 'all', 'media', 0, '', ?, ?, ?, '', 1)
		`, "snowbunniesai", "Snow Bunnies", "", 42, "{invalid json", 777, 888, buildFetchKey("snowbunniesai", "all", "media", false, ""))
		if err != nil {
			t.Fatalf("insert account: %v", err)
		}

		accounts, err := GetAllAccounts()
		if err != nil {
			t.Fatalf("get all accounts: %v", err)
		}
		if len(accounts) != 1 {
			t.Fatalf("expected 1 account, got %d", len(accounts))
		}

		account := accounts[0]
		if account.FollowersCount != 777 || account.StatusesCount != 888 {
			t.Fatalf("expected metrics from columns, got %d/%d", account.FollowersCount, account.StatusesCount)
		}
	})
}
