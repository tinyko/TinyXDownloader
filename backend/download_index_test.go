package backend

import (
	"database/sql"
	"testing"
	"time"
)

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
