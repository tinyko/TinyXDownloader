package backend

import (
	"encoding/json"
	"testing"
)

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
