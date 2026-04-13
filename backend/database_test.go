package backend

import (
	"database/sql"
	"encoding/json"
	"testing"
)

func withTestDB(t *testing.T, fn func()) {
	t.Helper()

	previousDB := db
	testDB, err := sql.Open("sqlite3", ":memory:")
	if err != nil {
		t.Fatalf("open test db: %v", err)
	}
	testDB.SetMaxOpenConns(1)
	db = testDB

	t.Cleanup(func() {
		if db != nil {
			_ = db.Close()
		}
		db = previousDB
	})

	fn()
}

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

func TestGetAccountResponseByScopeReturnsExactSnapshot(t *testing.T) {
	withTestDB(t, func() {
		if err := ensureAccountsSchema(); err != nil {
			t.Fatalf("ensure schema: %v", err)
		}

		responseJSON := `{"account_info":{"name":"tarojob","nick":"Taro","followers_count":1,"statuses_count":2},"timeline":[],"total_urls":0,"metadata":{"new_entries":0,"page":0,"batch_size":0,"has_more":false},"cursor":"abc","completed":false}`
		if err := SaveAccountWithStatus("tarojob", "Taro", "", 0, responseJSON, "all", "media", false, "", "abc", false); err != nil {
			t.Fatalf("save account: %v", err)
		}

		snapshot, err := GetAccountResponseByScope("tarojob", "all", "media", false, "")
		if err != nil {
			t.Fatalf("get snapshot: %v", err)
		}

		var decoded TwitterResponse
		if err := json.Unmarshal([]byte(snapshot), &decoded); err != nil {
			t.Fatalf("unmarshal snapshot: %v", err)
		}

		if decoded.AccountInfo.Name != "tarojob" || decoded.AccountInfo.Nick != "Taro" {
			t.Fatalf("unexpected account info: %+v", decoded.AccountInfo)
		}
		if decoded.Cursor != "abc" || decoded.Metadata.Cursor != "abc" {
			t.Fatalf("expected cursor abc, got response=%q metadata=%q", decoded.Cursor, decoded.Metadata.Cursor)
		}
		if decoded.Completed {
			t.Fatalf("expected incomplete snapshot")
		}
	})
}

func TestSaveAccountSnapshotChunkPersistsIncrementalEntries(t *testing.T) {
	withTestDB(t, func() {
		if err := ensureAccountsSchema(); err != nil {
			t.Fatalf("ensure schema: %v", err)
		}

		scope := FetchScopeRecord{
			Username:     "tarojob",
			MediaType:    "all",
			TimelineType: "media",
			Retweets:     false,
			QueryKey:     "",
		}
		accountInfo := AccountInfo{
			Name:           "tarojob",
			Nick:           "Taro",
			Date:           "2026-04-13",
			FollowersCount: 99,
			FriendsCount:   42,
			ProfileImage:   "https://example.com/avatar.jpg",
			StatusesCount:  123,
		}

		if err := SaveAccountSnapshotChunk(scope, accountInfo, []TimelineEntry{
			{
				URL:       "https://example.com/1.jpg",
				Date:      "2026-04-13T10:00:00",
				TweetID:   TweetIDString(1001),
				Type:      "photo",
				Extension: "jpg",
			},
		}, "cursor-a", false, 1); err != nil {
			t.Fatalf("save first chunk: %v", err)
		}

		if err := SaveAccountSnapshotChunk(scope, accountInfo, []TimelineEntry{
			{
				URL:       "https://example.com/2.jpg",
				Date:      "2026-04-13T11:00:00",
				TweetID:   TweetIDString(1002),
				Type:      "photo",
				Extension: "jpg",
			},
		}, "", true, 2); err != nil {
			t.Fatalf("save second chunk: %v", err)
		}

		response, err := GetAccountResponseByScopeStructured("tarojob", "all", "media", false, "")
		if err != nil {
			t.Fatalf("load structured snapshot: %v", err)
		}
		if response == nil {
			t.Fatal("expected snapshot, got nil")
		}
		if response.TotalURLs != 2 || len(response.Timeline) != 2 {
			t.Fatalf("expected 2 timeline items, got total=%d len=%d", response.TotalURLs, len(response.Timeline))
		}
		if !response.Completed {
			t.Fatalf("expected completed snapshot")
		}
		if response.AccountInfo.FriendsCount != 42 {
			t.Fatalf("expected friends_count to round-trip, got %d", response.AccountInfo.FriendsCount)
		}
	})
}

func TestGetAccountResponseByScopeStructuredMigratesLegacySnapshot(t *testing.T) {
	withTestDB(t, func() {
		if err := ensureAccountsSchema(); err != nil {
			t.Fatalf("ensure schema: %v", err)
		}

		responseJSON := `{"account_info":{"name":"legacy_user","nick":"Legacy","date":"2026-04-01","followers_count":10,"friends_count":20,"profile_image":"https://example.com/avatar.jpg","statuses_count":30},"timeline":[{"url":"https://example.com/legacy.jpg","date":"2026-04-01T12:00:00","tweet_id":"555","type":"photo","is_retweet":false,"extension":"jpg","width":800,"height":600}],"total_urls":1,"metadata":{"new_entries":1,"page":0,"batch_size":0,"has_more":false},"cursor":"legacy-cursor","completed":true}`
		fetchKey := buildFetchKey("legacy_user", "all", "media", false, "")
		if _, err := db.Exec(`
			INSERT INTO accounts (
				username, name, profile_image, total_media, last_fetched, response_json,
				account_info_json, media_type, timeline_type, retweets, query_key,
				followers_count, statuses_count, fetch_key, cursor, completed, storage_version
			)
			VALUES (?, ?, ?, ?, datetime('now'), ?, '', 'all', 'media', 0, '', ?, ?, ?, ?, 1, 1)
		`, "legacy_user", "Legacy", "https://example.com/avatar.jpg", 1, responseJSON, 10, 30, fetchKey, "legacy-cursor"); err != nil {
			t.Fatalf("insert legacy row: %v", err)
		}

		response, err := GetAccountResponseByScopeStructured("legacy_user", "all", "media", false, "")
		if err != nil {
			t.Fatalf("load migrated structured snapshot: %v", err)
		}
		if response == nil || len(response.Timeline) != 1 {
			t.Fatalf("expected migrated timeline entry, got %+v", response)
		}

		var storageVersion int
		if err := db.QueryRow(`SELECT storage_version FROM accounts WHERE fetch_key = ?`, fetchKey).Scan(&storageVersion); err != nil {
			t.Fatalf("read storage version: %v", err)
		}
		if storageVersion != 2 {
			t.Fatalf("expected storage_version 2, got %d", storageVersion)
		}

		var itemCount int
		if err := db.QueryRow(`SELECT COUNT(*) FROM account_timeline_items WHERE fetch_key = ?`, fetchKey).Scan(&itemCount); err != nil {
			t.Fatalf("count migrated items: %v", err)
		}
		if itemCount != 1 {
			t.Fatalf("expected 1 migrated item, got %d", itemCount)
		}
	})
}
