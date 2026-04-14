package backend

import (
	"fmt"
	"testing"
)

func seedTimelinePageBenchmarkData(b *testing.B) FetchScopeRecord {
	b.Helper()

	if err := ensureAccountsSchema(); err != nil {
		b.Fatalf("ensure schema: %v", err)
	}

	scope := FetchScopeRecord{
		Username:     "timeline_bench_user",
		MediaType:    "all",
		TimelineType: "media",
		Retweets:     false,
		QueryKey:     "",
	}
	accountInfo := AccountInfo{
		Name:           "timeline_bench_user",
		Nick:           "Timeline Bench User",
		FollowersCount: 1234,
		StatusesCount:  5678,
	}

	entries := make([]TimelineEntry, 0, 1200)
	for index := 0; index < 1200; index++ {
		entryType := "photo"
		switch index % 4 {
		case 1:
			entryType = "video"
		case 2:
			entryType = "animated_gif"
		case 3:
			entryType = "text"
		}

		entry := TimelineEntry{
			URL:              fmt.Sprintf("https://example.com/%04d", index),
			Date:             fmt.Sprintf("2026-04-15T%02d:%02d:00", (index/60)%24, index%60),
			TweetID:          TweetIDString(100000 + index),
			Type:             entryType,
			Content:          fmt.Sprintf("benchmark content %04d", index),
			AuthorUsername:   "timeline_bench_user",
			OriginalFilename: fmt.Sprintf("entry-%04d.dat", index),
		}
		entries = append(entries, entry)
	}

	if err := SaveAccountSnapshotChunk(scope, accountInfo, entries, "", true, len(entries)); err != nil {
		b.Fatalf("save benchmark snapshot: %v", err)
	}

	return scope
}

func BenchmarkGetAccountTimelinePage(b *testing.B) {
	withBenchmarkDB(b, func() {
		scope := seedTimelinePageBenchmarkData(b)

		b.Run("all/date-desc", func(b *testing.B) {
			b.ResetTimer()
			for i := 0; i < b.N; i++ {
				page, err := GetAccountTimelinePage(scope, 0, 120, "all", "date-desc")
				if err != nil {
					b.Fatalf("GetAccountTimelinePage failed: %v", err)
				}
				if page == nil || len(page.Items) == 0 {
					b.Fatal("expected non-empty timeline page")
				}
			}
		})

		b.Run("gif/date-desc", func(b *testing.B) {
			b.ResetTimer()
			for i := 0; i < b.N; i++ {
				page, err := GetAccountTimelinePage(scope, 0, 120, "gif", "date-desc")
				if err != nil {
					b.Fatalf("GetAccountTimelinePage filtered failed: %v", err)
				}
				if page == nil || len(page.Items) == 0 {
					b.Fatal("expected non-empty filtered timeline page")
				}
			}
		})
	})
}
