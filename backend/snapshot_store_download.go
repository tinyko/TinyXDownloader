package backend

import (
	"database/sql"
	"strings"
)

type timelineMediaProjection struct {
	URL              string
	Date             string
	TweetID          string
	Type             string
	Content          sql.NullString
	AuthorUsername   sql.NullString
	OriginalFilename sql.NullString
	EntryJSON        string
}

func loadMediaItemsByFetchKey(fetchKey string, fallbackUsername string) ([]MediaItem, error) {
	if err := ensureTimelineProjectionHydrated(fetchKey); err != nil {
		return nil, err
	}

	rows, err := db.Query(`
		SELECT
			url,
			date_value,
			tweet_id,
			type,
			content,
			author_username,
			original_filename
		FROM account_timeline_items
		WHERE fetch_key = ?
		ORDER BY date_unix_ms DESC, tweet_id_num DESC, entry_key ASC
	`, fetchKey)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := make([]MediaItem, 0)
	for rows.Next() {
		var row timelineMediaProjection
		if err := rows.Scan(
			&row.URL,
			&row.Date,
			&row.TweetID,
			&row.Type,
			&row.Content,
			&row.AuthorUsername,
			&row.OriginalFilename,
		); err != nil {
			return nil, err
		}

		item, ok := buildMediaItemFromProjection(row, fallbackUsername)
		if !ok {
			continue
		}
		items = append(items, item)
	}

	if err := rows.Err(); err != nil {
		return nil, err
	}

	return items, nil
}

func LoadScopeMediaDownloadPayload(scope FetchScopeRecord) (*ScopeMediaDownloadPayload, error) {
	normalizedScope := normalizeFetchScopeRecord(scope)
	if db == nil {
		if err := InitDB(); err != nil {
			return nil, err
		}
	}

	summary, err := getAccountSummaryByFetchKey(buildFetchKeyFromScope(normalizedScope))
	if err != nil || summary == nil {
		return nil, err
	}

	if err := ensureSummaryMigrated(summary); err != nil {
		return nil, err
	}

	accountInfo := decodeSummaryAccountInfo(summary)
	fallbackUsername := strings.TrimSpace(accountInfo.Name)
	if err := ensureScopeDownloadMediaIndex(summary); err != nil {
		return nil, err
	}
	items, err := loadMediaItemsByFetchKey(summary.FetchKey, fallbackUsername)
	if err != nil {
		return nil, err
	}

	rootSubdirectory := ""
	switch normalizedScope.Username {
	case "bookmarks":
		rootSubdirectory = "My Bookmarks"
	case "likes":
		rootSubdirectory = "My Likes"
	}

	return &ScopeMediaDownloadPayload{
		Scope:            normalizedScope,
		Username:         fallbackUsername,
		RootSubdirectory: rootSubdirectory,
		Items:            items,
	}, nil
}
