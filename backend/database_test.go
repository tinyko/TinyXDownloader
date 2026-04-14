package backend

import (
	"database/sql"
	"encoding/json"
	"testing"
	"time"
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

func TestGetAccountByIDReturnsStructuredResponseJSON(t *testing.T) {
	withTestDB(t, func() {
		if err := ensureAccountsSchema(); err != nil {
			t.Fatalf("ensure schema: %v", err)
		}

		scope := FetchScopeRecord{
			Username:     "raw_json_user",
			MediaType:    "all",
			TimelineType: "media",
			Retweets:     false,
			QueryKey:     "",
		}
		accountInfo := AccountInfo{
			Name:           "raw_json_user",
			Nick:           "Raw JSON User",
			FollowersCount: 123,
			StatusesCount:  456,
		}
		timeline := []TimelineEntry{
			{
				URL:            "https://example.com/one.jpg",
				Date:           "2026-04-14T10:00:00",
				TweetID:        TweetIDString(4101),
				Type:           "photo",
				AuthorUsername: "raw_json_user",
			},
			{
				URL:            "https://example.com/two.jpg",
				Date:           "2026-04-14T09:00:00",
				TweetID:        TweetIDString(4100),
				Type:           "photo",
				AuthorUsername: "raw_json_user",
			},
		}

		if err := SaveAccountSnapshotChunk(scope, accountInfo, timeline, "cursor-4101", true, len(timeline)); err != nil {
			t.Fatalf("save account snapshot chunk: %v", err)
		}

		var id int64
		if err := db.QueryRow(`SELECT id FROM accounts WHERE fetch_key = ?`, buildFetchKeyFromScope(scope)).Scan(&id); err != nil {
			t.Fatalf("load account id: %v", err)
		}

		acc, err := GetAccountByID(id)
		if err != nil {
			t.Fatalf("get account by id: %v", err)
		}

		var decoded TwitterResponse
		if err := json.Unmarshal([]byte(acc.ResponseJSON), &decoded); err != nil {
			t.Fatalf("unmarshal account response json: %v", err)
		}

		if decoded.AccountInfo.Name != "raw_json_user" || decoded.AccountInfo.Nick != "Raw JSON User" {
			t.Fatalf("unexpected account info: %+v", decoded.AccountInfo)
		}
		if decoded.Cursor != "cursor-4101" || decoded.Metadata.Cursor != "cursor-4101" {
			t.Fatalf("expected cursor cursor-4101, got response=%q metadata=%q", decoded.Cursor, decoded.Metadata.Cursor)
		}
		if len(decoded.Timeline) != 2 {
			t.Fatalf("expected 2 timeline items, got %d", len(decoded.Timeline))
		}
		if int64(decoded.Timeline[0].TweetID) != 4101 || int64(decoded.Timeline[1].TweetID) != 4100 {
			t.Fatalf("expected tweet ids to survive JSON path, got %+v", decoded.Timeline)
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

func TestEnsureAccountTimelineItemsSchemaAddsProjectionColumns(t *testing.T) {
	withTestDB(t, func() {
		if _, err := db.Exec(`
			CREATE TABLE account_timeline_items (
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
		`); err != nil {
			t.Fatalf("create legacy timeline items table: %v", err)
		}

		if err := ensureAccountTimelineItemsSchema(); err != nil {
			t.Fatalf("ensure timeline schema: %v", err)
		}

		columns, err := getTableColumns("account_timeline_items")
		if err != nil {
			t.Fatalf("get timeline item columns: %v", err)
		}

		if !columns["content"] || !columns["author_username"] || !columns["original_filename"] {
			t.Fatalf("expected projection columns to be added, got %+v", columns)
		}
	})
}

func TestGetAccountSnapshotSummaryAndTweetIDsStructured(t *testing.T) {
	withTestDB(t, func() {
		if err := ensureAccountsSchema(); err != nil {
			t.Fatalf("ensure schema: %v", err)
		}

		scope := FetchScopeRecord{
			Username:     "summary_user",
			MediaType:    "all",
			TimelineType: "media",
			Retweets:     false,
			QueryKey:     "",
		}
		accountInfo := AccountInfo{
			Name:           "summary_user",
			Nick:           "Summary User",
			FollowersCount: 12,
			FriendsCount:   5,
			StatusesCount:  99,
		}

		if err := SaveAccountSnapshotChunk(scope, accountInfo, []TimelineEntry{
			{
				URL:            "https://example.com/first.jpg",
				Date:           "2026-04-13T10:00:00",
				TweetID:        TweetIDString(1001),
				Type:           "photo",
				AuthorUsername: "summary_user",
			},
		}, "cursor-a", false, 1); err != nil {
			t.Fatalf("save first chunk: %v", err)
		}

		if err := SaveAccountSnapshotChunk(scope, accountInfo, []TimelineEntry{
			{
				URL:            "https://example.com/second.jpg",
				Date:           "2026-04-13T11:00:00",
				TweetID:        TweetIDString(1002),
				Type:           "photo",
				AuthorUsername: "summary_user",
			},
			{
				URL:            "https://example.com/second-alt.jpg",
				Date:           "2026-04-13T11:00:00",
				TweetID:        TweetIDString(1002),
				Type:           "photo",
				AuthorUsername: "summary_user",
			},
		}, "", true, 3); err != nil {
			t.Fatalf("save second chunk: %v", err)
		}

		summary, err := GetAccountSnapshotSummaryStructured("summary_user", "all", "media", false, "")
		if err != nil {
			t.Fatalf("get snapshot summary: %v", err)
		}
		if summary == nil {
			t.Fatal("expected summary, got nil")
		}
		if summary.TotalURLs != 3 {
			t.Fatalf("expected total_urls 3, got %d", summary.TotalURLs)
		}
		if !summary.Completed {
			t.Fatalf("expected completed summary")
		}
		if summary.AccountInfo.FriendsCount != 5 {
			t.Fatalf("expected account info to round-trip, got %+v", summary.AccountInfo)
		}

		tweetIDs, err := GetAccountSnapshotTweetIDs(scope)
		if err != nil {
			t.Fatalf("get tweet ids: %v", err)
		}
		if len(tweetIDs) != 2 {
			t.Fatalf("expected 2 unique tweet ids, got %d", len(tweetIDs))
		}
		if tweetIDs[0] != "1002" || tweetIDs[1] != "1001" {
			t.Fatalf("unexpected tweet id order: %+v", tweetIDs)
		}
	})
}

func TestLoadScopeMediaDownloadPayloadFallsBackToEntryJSON(t *testing.T) {
	withTestDB(t, func() {
		if err := ensureAccountsSchema(); err != nil {
			t.Fatalf("ensure schema: %v", err)
		}

		scope := FetchScopeRecord{
			Username:     "payload_user",
			MediaType:    "all",
			TimelineType: "media",
			Retweets:     false,
			QueryKey:     "",
		}
		accountInfo := AccountInfo{
			Name: "payload_user",
			Nick: "Payload User",
		}
		entry := TimelineEntry{
			URL:              "https://example.com/payload.jpg",
			Date:             "2026-04-13T12:00:00",
			TweetID:          TweetIDString(9988),
			Type:             "photo",
			Content:          "payload content",
			AuthorUsername:   "author_from_entry",
			OriginalFilename: "payload.jpg",
		}

		if err := SaveAccountSnapshotChunk(scope, accountInfo, []TimelineEntry{entry}, "", true, 1); err != nil {
			t.Fatalf("save snapshot chunk: %v", err)
		}

		fetchKey := buildFetchKeyFromScope(scope)
		if _, err := db.Exec(`
			UPDATE account_timeline_items
			SET content = NULL, author_username = NULL, original_filename = NULL
			WHERE fetch_key = ?
		`, fetchKey); err != nil {
			t.Fatalf("clear projection columns: %v", err)
		}

		payload, err := LoadScopeMediaDownloadPayload(scope)
		if err != nil {
			t.Fatalf("load download payload: %v", err)
		}
		if payload == nil {
			t.Fatal("expected payload, got nil")
		}
		if len(payload.Items) != 1 {
			t.Fatalf("expected 1 payload item, got %d", len(payload.Items))
		}

		item := payload.Items[0]
		if item.Content != "payload content" {
			t.Fatalf("expected fallback content, got %q", item.Content)
		}
		if item.Username != "author_from_entry" {
			t.Fatalf("expected fallback username, got %q", item.Username)
		}
		if item.OriginalFilename != "payload.jpg" {
			t.Fatalf("expected fallback original filename, got %q", item.OriginalFilename)
		}
		if item.TweetID != 9988 {
			t.Fatalf("expected fallback tweet id 9988, got %d", item.TweetID)
		}
	})
}

func TestSaveAccountSnapshotChunkBuildsDownloadMediaIndex(t *testing.T) {
	withTestDB(t, func() {
		if err := ensureAccountsSchema(); err != nil {
			t.Fatalf("ensure schema: %v", err)
		}

		scope := FetchScopeRecord{
			Username:     "payload_user",
			MediaType:    "all",
			TimelineType: "media",
			Retweets:     false,
			QueryKey:     "",
		}
		accountInfo := AccountInfo{
			Name: "payload_user",
			Nick: "Payload User",
		}

		if err := SaveAccountSnapshotChunk(scope, accountInfo, []TimelineEntry{
			{
				URL:              "https://example.com/payload.jpg",
				Date:             "2026-04-13T12:00:00",
				TweetID:          TweetIDString(9988),
				Type:             "photo",
				AuthorUsername:   "author_from_entry",
				OriginalFilename: "payload.jpg",
			},
			{
				URL:              "https://example.com/payload-2.jpg",
				Date:             "2026-04-13T12:00:00",
				TweetID:          TweetIDString(9988),
				Type:             "photo",
				AuthorUsername:   "author_from_entry",
				OriginalFilename: "payload-2.jpg",
			},
		}, "", true, 2); err != nil {
			t.Fatalf("save snapshot chunk: %v", err)
		}

		var count int
		if err := db.QueryRow(`
			SELECT COUNT(*)
			FROM download_media_index
			WHERE fetch_key = ?
		`, buildFetchKeyFromScope(scope)).Scan(&count); err != nil {
			t.Fatalf("count download media index rows: %v", err)
		}
		if count != 2 {
			t.Fatalf("expected 2 download index rows, got %d", count)
		}
	})
}

func TestGetAccountTimelinePageUsesProjectionPagination(t *testing.T) {
	withTestDB(t, func() {
		if err := ensureAccountsSchema(); err != nil {
			t.Fatalf("ensure schema: %v", err)
		}

		scope := FetchScopeRecord{
			Username:     "paged_user",
			MediaType:    "all",
			TimelineType: "media",
			Retweets:     false,
			QueryKey:     "",
		}
		accountInfo := AccountInfo{
			Name:           "paged_user",
			Nick:           "Paged User",
			FollowersCount: 11,
			StatusesCount:  22,
		}

		if err := SaveAccountSnapshotChunk(scope, accountInfo, []TimelineEntry{
			{
				URL:     "https://example.com/3.jpg",
				Date:    "2026-04-13T12:00:00",
				TweetID: TweetIDString(1003),
				Type:    "photo",
			},
			{
				URL:     "https://example.com/2.mp4",
				Date:    "2026-04-13T11:00:00",
				TweetID: TweetIDString(1002),
				Type:    "video",
			},
			{
				URL:     "https://example.com/1.gif",
				Date:    "2026-04-13T10:00:00",
				TweetID: TweetIDString(1001),
				Type:    "animated_gif",
			},
		}, "", true, 3); err != nil {
			t.Fatalf("save snapshot chunk: %v", err)
		}

		bootstrap, err := GetAccountTimelineBootstrap(scope, "all")
		if err != nil {
			t.Fatalf("get timeline bootstrap: %v", err)
		}
		if bootstrap == nil {
			t.Fatal("expected bootstrap, got nil")
		}
		if bootstrap.TotalItems != 3 {
			t.Fatalf("expected bootstrap total items 3, got %d", bootstrap.TotalItems)
		}
		if bootstrap.MediaCounts.Photo != 1 || bootstrap.MediaCounts.Video != 1 || bootstrap.MediaCounts.GIF != 1 {
			t.Fatalf("unexpected bootstrap media counts: %+v", bootstrap.MediaCounts)
		}

		itemsPage, err := GetAccountTimelineItemsPage(scope, 0, 2, "all", "date-desc")
		if err != nil {
			t.Fatalf("get timeline items page: %v", err)
		}
		if itemsPage == nil {
			t.Fatal("expected items page, got nil")
		}
		if len(itemsPage.Items) != 2 {
			t.Fatalf("expected 2 items page entries, got %d", len(itemsPage.Items))
		}
		if !itemsPage.HasMore || itemsPage.NextOffset != 2 {
			t.Fatalf("expected items page hasMore with next offset 2, got hasMore=%v next=%d", itemsPage.HasMore, itemsPage.NextOffset)
		}
		if itemsPage.Items[0].TweetID != "1003" || itemsPage.Items[1].TweetID != "1002" {
			t.Fatalf("unexpected items page order: %+v", itemsPage.Items)
		}

		page, err := GetAccountTimelinePage(scope, 0, 2, "all", "date-desc")
		if err != nil {
			t.Fatalf("get timeline page: %v", err)
		}
		if page == nil {
			t.Fatal("expected page, got nil")
		}
		if page.TotalItems != 3 {
			t.Fatalf("expected total items 3, got %d", page.TotalItems)
		}
		if len(page.Items) != 2 {
			t.Fatalf("expected 2 page items, got %d", len(page.Items))
		}
		if !page.HasMore || page.NextOffset != 2 {
			t.Fatalf("expected hasMore with next offset 2, got hasMore=%v next=%d", page.HasMore, page.NextOffset)
		}
		if page.MediaCounts.Photo != 1 || page.MediaCounts.Video != 1 || page.MediaCounts.GIF != 1 {
			t.Fatalf("unexpected media counts: %+v", page.MediaCounts)
		}
		if page.Items[0].TweetID != "1003" || page.Items[1].TweetID != "1002" {
			t.Fatalf("unexpected page order: %+v", page.Items)
		}

		filteredPage, err := GetAccountTimelinePage(scope, 0, 10, "gif", "date-desc")
		if err != nil {
			t.Fatalf("get filtered timeline page: %v", err)
		}
		if filteredPage == nil || filteredPage.TotalItems != 1 || len(filteredPage.Items) != 1 {
			t.Fatalf("expected one GIF item, got %+v", filteredPage)
		}
		if filteredPage.Items[0].Type != "animated_gif" {
			t.Fatalf("expected animated_gif result, got %q", filteredPage.Items[0].Type)
		}
	})
}

func TestGetAccountTimelinePageFallsBackToEntryJSON(t *testing.T) {
	withTestDB(t, func() {
		if err := ensureAccountsSchema(); err != nil {
			t.Fatalf("ensure schema: %v", err)
		}

		scope := FetchScopeRecord{
			Username:     "paged_fallback_user",
			MediaType:    "all",
			TimelineType: "media",
			Retweets:     false,
			QueryKey:     "",
		}
		accountInfo := AccountInfo{
			Name: "paged_fallback_user",
			Nick: "Paged Fallback User",
		}
		entry := TimelineEntry{
			URL:              "https://example.com/fallback.jpg",
			Date:             "2026-04-13T12:00:00",
			TweetID:          TweetIDString(2001),
			Type:             "photo",
			Content:          "fallback page content",
			AuthorUsername:   "fallback_page_author",
			OriginalFilename: "fallback-page.jpg",
		}

		if err := SaveAccountSnapshotChunk(scope, accountInfo, []TimelineEntry{entry}, "", true, 1); err != nil {
			t.Fatalf("save snapshot chunk: %v", err)
		}

		fetchKey := buildFetchKeyFromScope(scope)
		if _, err := db.Exec(`
			UPDATE account_timeline_items
			SET content = NULL, author_username = NULL, original_filename = NULL
			WHERE fetch_key = ?
		`, fetchKey); err != nil {
			t.Fatalf("clear projection columns: %v", err)
		}

		bootstrap, err := GetAccountTimelineBootstrap(scope, "all")
		if err != nil {
			t.Fatalf("get timeline bootstrap: %v", err)
		}
		if bootstrap == nil {
			t.Fatal("expected bootstrap, got nil")
		}
		if bootstrap.TotalItems != 1 {
			t.Fatalf("expected bootstrap total items 1, got %d", bootstrap.TotalItems)
		}

		var bootstrapContent, bootstrapAuthor, bootstrapFilename sql.NullString
		if err := db.QueryRow(`
			SELECT content, author_username, original_filename
			FROM account_timeline_items
			WHERE fetch_key = ?
		`, fetchKey).Scan(&bootstrapContent, &bootstrapAuthor, &bootstrapFilename); err != nil {
			t.Fatalf("read projection columns after bootstrap: %v", err)
		}
		if bootstrapContent.Valid || bootstrapAuthor.Valid || bootstrapFilename.Valid {
			t.Fatal("expected bootstrap fast path to avoid hydrating projection columns")
		}

		itemsPage, err := GetAccountTimelineItemsPage(scope, 0, 10, "all", "date-desc")
		if err != nil {
			t.Fatalf("get timeline items page: %v", err)
		}
		if itemsPage == nil {
			t.Fatal("expected items page, got nil")
		}
		if len(itemsPage.Items) != 1 {
			t.Fatalf("expected 1 page item, got %d", len(itemsPage.Items))
		}

		item := itemsPage.Items[0]
		if item.Content != "fallback page content" {
			t.Fatalf("expected fallback content, got %q", item.Content)
		}
		if item.AuthorUsername != "fallback_page_author" {
			t.Fatalf("expected fallback author username, got %q", item.AuthorUsername)
		}
		if item.OriginalFilename != "fallback-page.jpg" {
			t.Fatalf("expected fallback original filename, got %q", item.OriginalFilename)
		}

		var hydratedContent, hydratedAuthor, hydratedFilename sql.NullString
		if err := db.QueryRow(`
			SELECT content, author_username, original_filename
			FROM account_timeline_items
			WHERE fetch_key = ?
		`, fetchKey).Scan(&hydratedContent, &hydratedAuthor, &hydratedFilename); err != nil {
			t.Fatalf("read hydrated projection columns: %v", err)
		}
		if !hydratedContent.Valid || !hydratedAuthor.Valid || !hydratedFilename.Valid {
			t.Fatal("expected projection columns to be hydrated in-place")
		}
		if hydratedContent.String != "fallback page content" {
			t.Fatalf("expected hydrated content, got %q", hydratedContent.String)
		}
	})
}

func TestListDownloadMediaIndexRepairCandidatesIdentifiesMissingStaleAndMismatchedScopes(t *testing.T) {
	withTestDB(t, func() {
		if err := ensureAccountsSchema(); err != nil {
			t.Fatalf("ensure schema: %v", err)
		}

		makeScope := func(username string) FetchScopeRecord {
			return FetchScopeRecord{
				Username:     username,
				MediaType:    "all",
				TimelineType: "media",
				Retweets:     false,
				QueryKey:     "",
			}
		}
		makeEntry := func(tweetID int64, suffix string) TimelineEntry {
			return TimelineEntry{
				URL:     "https://example.com/" + suffix,
				Date:    "2026-04-13T12:00:00",
				TweetID: TweetIDString(tweetID),
				Type:    "photo",
			}
		}

		if err := SaveAccountSnapshotChunk(makeScope("fresh_scope"), AccountInfo{Name: "fresh_scope"}, []TimelineEntry{
			makeEntry(1001, "fresh.jpg"),
		}, "", true, 1); err != nil {
			t.Fatalf("save fresh scope: %v", err)
		}

		if err := SaveAccountSnapshotChunk(makeScope("missing_scope"), AccountInfo{Name: "missing_scope"}, []TimelineEntry{
			makeEntry(1002, "missing.jpg"),
		}, "", true, 1); err != nil {
			t.Fatalf("save missing scope: %v", err)
		}

		if err := SaveAccountSnapshotChunk(makeScope("stale_scope"), AccountInfo{Name: "stale_scope"}, []TimelineEntry{
			makeEntry(1003, "stale.jpg"),
		}, "", true, 1); err != nil {
			t.Fatalf("save stale scope: %v", err)
		}

		if err := SaveAccountSnapshotChunk(makeScope("mismatch_scope"), AccountInfo{Name: "mismatch_scope"}, []TimelineEntry{
			makeEntry(1004, "mismatch-a.jpg"),
			makeEntry(1005, "mismatch-b.jpg"),
		}, "", true, 2); err != nil {
			t.Fatalf("save mismatch scope: %v", err)
		}

		if err := SaveAccountSnapshotChunk(makeScope("empty_scope"), AccountInfo{Name: "empty_scope"}, nil, "", true, 0); err != nil {
			t.Fatalf("save empty scope: %v", err)
		}

		missingFetchKey := buildFetchKeyFromScope(makeScope("missing_scope"))
		if _, err := db.Exec(`DELETE FROM download_media_index WHERE fetch_key = ?`, missingFetchKey); err != nil {
			t.Fatalf("delete missing scope index rows: %v", err)
		}

		staleFetchKey := buildFetchKeyFromScope(makeScope("stale_scope"))
		staleLastFetched := time.Now().Add(5 * time.Minute)
		if _, err := db.Exec(`UPDATE accounts SET last_fetched = ? WHERE fetch_key = ?`, staleLastFetched, staleFetchKey); err != nil {
			t.Fatalf("mark stale scope last fetched: %v", err)
		}

		mismatchFetchKey := buildFetchKeyFromScope(makeScope("mismatch_scope"))
		if _, err := db.Exec(`
			DELETE FROM download_media_index
			WHERE fetch_key = ?
			AND entry_key = ?
		`, mismatchFetchKey, buildTimelineEntryStorageKey(makeEntry(1005, "mismatch-b.jpg"))); err != nil {
			t.Fatalf("delete mismatch scope index row: %v", err)
		}

		candidateFetchKeys, err := listDownloadMediaIndexRepairFetchKeys()
		if err != nil {
			t.Fatalf("list repair fetch keys: %v", err)
		}

		candidateKeys := make(map[string]struct{}, len(candidateFetchKeys))
		for _, fetchKey := range candidateFetchKeys {
			candidateKeys[fetchKey] = struct{}{}
		}

		if _, ok := candidateKeys[buildFetchKeyFromScope(makeScope("fresh_scope"))]; ok {
			t.Fatal("did not expect fresh scope to need repair")
		}
		if _, ok := candidateKeys[buildFetchKeyFromScope(makeScope("empty_scope"))]; ok {
			t.Fatal("did not expect empty scope to need repair")
		}
		if _, ok := candidateKeys[missingFetchKey]; !ok {
			t.Fatal("expected missing scope to need repair")
		}
		if _, ok := candidateKeys[staleFetchKey]; !ok {
			t.Fatal("expected stale scope to need repair")
		}
		if _, ok := candidateKeys[mismatchFetchKey]; !ok {
			t.Fatal("expected mismatched scope to need repair")
		}
	})
}

func TestLoadTrackedMediaIndexRepairsOnlyStaleScopes(t *testing.T) {
	withTestDB(t, func() {
		if err := ensureAccountsSchema(); err != nil {
			t.Fatalf("ensure schema: %v", err)
		}

		freshScope := FetchScopeRecord{
			Username:     "fresh_integrity",
			MediaType:    "all",
			TimelineType: "media",
			Retweets:     false,
			QueryKey:     "",
		}
		missingScope := FetchScopeRecord{
			Username:     "missing_integrity",
			MediaType:    "all",
			TimelineType: "media",
			Retweets:     false,
			QueryKey:     "",
		}

		freshEntry := TimelineEntry{
			URL:     "https://example.com/fresh-integrity.jpg",
			Date:    "2026-04-13T12:00:00",
			TweetID: TweetIDString(3001),
			Type:    "photo",
		}
		missingEntry := TimelineEntry{
			URL:     "https://example.com/missing-integrity.jpg",
			Date:    "2026-04-13T12:00:00",
			TweetID: TweetIDString(3002),
			Type:    "photo",
		}

		if err := SaveAccountSnapshotChunk(freshScope, AccountInfo{Name: freshScope.Username}, []TimelineEntry{freshEntry}, "", true, 1); err != nil {
			t.Fatalf("save fresh scope: %v", err)
		}
		if err := SaveAccountSnapshotChunk(missingScope, AccountInfo{Name: missingScope.Username}, []TimelineEntry{missingEntry}, "", true, 1); err != nil {
			t.Fatalf("save missing scope: %v", err)
		}

		freshFetchKey := buildFetchKeyFromScope(freshScope)
		missingFetchKey := buildFetchKeyFromScope(missingScope)

		var freshUpdatedBefore sql.NullInt64
		if err := db.QueryRow(`
			SELECT CAST(MAX(strftime('%s', updated_at)) AS INTEGER)
			FROM download_media_index
			WHERE fetch_key = ?
		`, freshFetchKey).Scan(&freshUpdatedBefore); err != nil {
			t.Fatalf("read fresh scope updated_at before: %v", err)
		}

		if _, err := db.Exec(`DELETE FROM download_media_index WHERE fetch_key = ?`, missingFetchKey); err != nil {
			t.Fatalf("delete missing scope index rows: %v", err)
		}

		tracked, err := loadTrackedMediaIndex(t.TempDir())
		if err != nil {
			t.Fatalf("load tracked media index: %v", err)
		}
		if len(tracked) != 2 {
			t.Fatalf("expected 2 tracked files after repair, got %d", len(tracked))
		}

		var missingIndexCount int
		if err := db.QueryRow(`
			SELECT COUNT(*)
			FROM download_media_index
			WHERE fetch_key = ?
		`, missingFetchKey).Scan(&missingIndexCount); err != nil {
			t.Fatalf("count repaired missing scope rows: %v", err)
		}
		if missingIndexCount != 1 {
			t.Fatalf("expected missing scope to be rebuilt with 1 row, got %d", missingIndexCount)
		}

		var freshUpdatedAfter sql.NullInt64
		if err := db.QueryRow(`
			SELECT CAST(MAX(strftime('%s', updated_at)) AS INTEGER)
			FROM download_media_index
			WHERE fetch_key = ?
		`, freshFetchKey).Scan(&freshUpdatedAfter); err != nil {
			t.Fatalf("read fresh scope updated_at after: %v", err)
		}
		if !freshUpdatedBefore.Valid || !freshUpdatedAfter.Valid {
			t.Fatalf("expected valid updated_at timestamps, before=%+v after=%+v", freshUpdatedBefore, freshUpdatedAfter)
		}
		if freshUpdatedAfter.Int64 != freshUpdatedBefore.Int64 {
			t.Fatalf("expected fresh scope index timestamp to remain unchanged, before=%v after=%v", freshUpdatedBefore, freshUpdatedAfter)
		}
	})
}
