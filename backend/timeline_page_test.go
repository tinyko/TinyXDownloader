package backend

import (
	"database/sql"
	"testing"
)

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
