package backend

import (
	"fmt"
	"strings"
	"testing"
	"time"
)

func seedSavedAccountsQueryPlanData(t *testing.T) {
	t.Helper()

	if err := ensureAccountsSchema(); err != nil {
		t.Fatalf("ensure schema: %v", err)
	}

	tx, err := db.Begin()
	if err != nil {
		t.Fatalf("begin seed transaction: %v", err)
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
		t.Fatalf("prepare seed statement: %v", err)
	}

	baseTime := time.Date(2026, 4, 15, 12, 0, 0, 0, time.UTC)
	for index := 0; index < 180; index++ {
		username := fmt.Sprintf("plan_user_%03d", index)
		groupName := "artists"
		groupColor := "#f97316"
		mediaType := "video"
		timelineType := "media"
		queryKey := ""

		switch index % 3 {
		case 1:
			groupName = "news"
			groupColor = "#3b82f6"
			mediaType = "image"
		case 2:
			groupName = ""
			groupColor = ""
			mediaType = "all"
		}

		if index%25 == 0 {
			username = "bookmarks"
			groupName = ""
			groupColor = ""
			mediaType = "all"
			timelineType = "bookmarks"
			queryKey = fmt.Sprintf("bookmark-%03d", index)
		} else if index%40 == 0 {
			username = "likes"
			groupName = ""
			groupColor = ""
			mediaType = "all"
			timelineType = "likes"
			queryKey = fmt.Sprintf("likes-%03d", index)
		}

		if _, err := stmt.Exec(
			username,
			fmt.Sprintf("Plan User %03d", index),
			200+(index%20),
			baseTime.Add(-time.Duration(index)*time.Minute),
			groupName,
			groupColor,
			mediaType,
			timelineType,
			0,
			queryKey,
			1000+(index*2),
			2000+(index*3),
			buildFetchKey(username, mediaType, timelineType, false, queryKey),
		); err != nil {
			_ = stmt.Close()
			_ = tx.Rollback()
			t.Fatalf("seed row %d: %v", index, err)
		}
	}

	if err := stmt.Close(); err != nil {
		_ = tx.Rollback()
		t.Fatalf("close seed statement: %v", err)
	}
	if _, err := tx.Exec(`ANALYZE`); err != nil {
		_ = tx.Rollback()
		t.Fatalf("analyze seed data: %v", err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatalf("commit seed transaction: %v", err)
	}
}

func explainQueryPlanDetails(t *testing.T, query string, args ...interface{}) []string {
	t.Helper()

	rows, err := db.Query("EXPLAIN QUERY PLAN "+query, args...)
	if err != nil {
		t.Fatalf("explain query plan: %v", err)
	}
	defer rows.Close()

	details := make([]string, 0)
	for rows.Next() {
		var id int
		var parent int
		var notUsed int
		var detail string
		if err := rows.Scan(&id, &parent, &notUsed, &detail); err != nil {
			t.Fatalf("scan query plan row: %v", err)
		}
		details = append(details, detail)
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("iterate query plan rows: %v", err)
	}
	return details
}

func requireQueryPlanUsesIndex(t *testing.T, details []string, indexName string) {
	t.Helper()

	for _, detail := range details {
		if strings.Contains(detail, indexName) {
			return
		}
	}

	t.Fatalf("expected query plan to use %s, got %v", indexName, details)
}

func TestSavedAccountsQueryPlansUseIndexes(t *testing.T) {
	withTestDB(t, func() {
		seedSavedAccountsQueryPlanData(t)

		newestQuery, newestArgs := buildSavedAccountsPageQuery(
			"public",
			"",
			"all",
			"all-media",
			"newest",
			0,
			50,
		)
		requireQueryPlanUsesIndex(
			t,
			explainQueryPlanDetails(t, newestQuery, newestArgs...),
			"idx_accounts_saved_view_last_fetched",
		)

		followersQuery, followersArgs := buildSavedAccountsPageQuery(
			"public",
			"",
			"artists",
			"image",
			"followers-high",
			0,
			50,
		)
		requireQueryPlanUsesIndex(
			t,
			explainQueryPlanDetails(t, followersQuery, followersArgs...),
			"idx_accounts_saved_filters_followers",
		)

		postsQuery, postsArgs := buildSavedAccountsPageQuery(
			"public",
			"",
			"news",
			"video",
			"posts-high",
			0,
			50,
		)
		requireQueryPlanUsesIndex(
			t,
			explainQueryPlanDetails(t, postsQuery, postsArgs...),
			"idx_accounts_saved_filters_statuses",
		)

		matchingQuery, matchingArgs := buildSavedAccountMatchingIDsQuery(
			"public",
			"",
			"artists",
			"image",
		)
		requireQueryPlanUsesIndex(
			t,
			explainQueryPlanDetails(t, matchingQuery, matchingArgs...),
			"idx_accounts_saved_filters_matching_ids",
		)
	})
}
