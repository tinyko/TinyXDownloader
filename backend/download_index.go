package backend

import (
	"database/sql"
	"path/filepath"
	"strings"
	"time"
)

const downloadMediaIndexTableSchema = `
	CREATE TABLE IF NOT EXISTS download_media_index (
		fetch_key TEXT NOT NULL,
		entry_key TEXT NOT NULL,
		relative_path TEXT NOT NULL,
		download_username TEXT NOT NULL,
		url TEXT NOT NULL,
		tweet_id TEXT NOT NULL,
		media_type TEXT NOT NULL,
		updated_at DATETIME NOT NULL,
		PRIMARY KEY (fetch_key, entry_key)
	)
`

func ensureDownloadMediaIndexSchema() error {
	if _, err := db.Exec(downloadMediaIndexTableSchema); err != nil {
		return err
	}
	if _, err := db.Exec(`
		CREATE INDEX IF NOT EXISTS idx_download_media_index_relative_path
		ON download_media_index(relative_path)
	`); err != nil {
		return err
	}
	if _, err := db.Exec(`
		CREATE INDEX IF NOT EXISTS idx_download_media_index_fetch_key
		ON download_media_index(fetch_key)
	`); err != nil {
		return err
	}
	return nil
}

func scopeRootSubdirectory(scope FetchScopeRecord) string {
	switch strings.TrimSpace(scope.Username) {
	case "bookmarks":
		return "My Bookmarks"
	case "likes":
		return "My Likes"
	default:
		return ""
	}
}

func buildDownloadRelativePath(rootSubdirectory, username, mediaType, filename string) string {
	parts := make([]string, 0, 4)
	if strings.TrimSpace(rootSubdirectory) != "" {
		parts = append(parts, rootSubdirectory)
	}
	if strings.TrimSpace(username) != "" {
		parts = append(parts, username)
	}
	parts = append(parts, mediaSubfolder(mediaType), filename)
	return filepath.Join(parts...)
}

func rebuildDownloadMediaIndexForScope(summary *accountSummaryRecord) error {
	if summary == nil {
		return nil
	}
	if db == nil {
		if err := InitDB(); err != nil {
			return err
		}
	}

	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	if err := rebuildDownloadMediaIndexForScopeTx(tx, summary, time.Now()); err != nil {
		return err
	}

	return tx.Commit()
}

func ensureScopeDownloadMediaIndex(summary *accountSummaryRecord) error {
	if summary == nil {
		return nil
	}
	if db == nil {
		if err := InitDB(); err != nil {
			return err
		}
	}

	if err := ensureSummaryMigrated(summary); err != nil {
		return err
	}

	var timelineCount int
	if err := db.QueryRow(`
		SELECT COUNT(*)
		FROM account_timeline_items
		WHERE fetch_key = ?
	`, summary.FetchKey).Scan(&timelineCount); err != nil {
		return err
	}
	if timelineCount == 0 {
		return nil
	}

	var indexCount int
	if err := db.QueryRow(`
		SELECT COUNT(*)
		FROM download_media_index
		WHERE fetch_key = ?
	`, summary.FetchKey).Scan(&indexCount); err != nil {
		return err
	}
	if indexCount == timelineCount {
		return nil
	}

	return rebuildDownloadMediaIndexForScope(summary)
}

func rebuildDownloadMediaIndexForScopeTx(tx *sql.Tx, summary *accountSummaryRecord, updatedAt time.Time) error {
	if summary == nil {
		return nil
	}

	accountInfo := decodeSummaryAccountInfo(summary)
	scope := FetchScopeRecord{
		Username:     summary.Username,
		MediaType:    summary.MediaType,
		TimelineType: summary.TimelineType,
		Retweets:     summary.Retweets,
		QueryKey:     summary.QueryKey,
	}
	rootSubdirectory := scopeRootSubdirectory(scope)
	fallbackUsername := strings.TrimSpace(accountInfo.Name)

	if _, err := tx.Exec(`DELETE FROM download_media_index WHERE fetch_key = ?`, summary.FetchKey); err != nil {
		return err
	}

	rows, err := tx.Query(`
		SELECT
			entry_key,
			url,
			date_value,
			tweet_id,
			type,
			content,
			author_username,
			original_filename,
			entry_json
		FROM account_timeline_items
		WHERE fetch_key = ?
		ORDER BY date_unix_ms DESC, tweet_id_num DESC, entry_key ASC
	`, summary.FetchKey)
	if err != nil {
		return err
	}
	defer rows.Close()

	insertStmt, err := tx.Prepare(`
		INSERT INTO download_media_index (
			fetch_key, entry_key, relative_path, download_username, url, tweet_id, media_type, updated_at
		)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(fetch_key, entry_key) DO UPDATE SET
			relative_path = excluded.relative_path,
			download_username = excluded.download_username,
			url = excluded.url,
			tweet_id = excluded.tweet_id,
			media_type = excluded.media_type,
			updated_at = excluded.updated_at
	`)
	if err != nil {
		return err
	}
	defer insertStmt.Close()

	tweetMediaCount := make(map[string]map[int64]int)
	for rows.Next() {
		var entryKey string
		var row timelineMediaProjection
		if err := rows.Scan(
			&entryKey,
			&row.URL,
			&row.Date,
			&row.TweetID,
			&row.Type,
			&row.Content,
			&row.AuthorUsername,
			&row.OriginalFilename,
			&row.EntryJSON,
		); err != nil {
			return err
		}

		item, ok := buildMediaItemFromProjection(row, fallbackUsername)
		if !ok {
			continue
		}

		downloadUsername := resolveDownloadUsername(item, fallbackUsername)
		if downloadUsername == "" {
			continue
		}
		mediaIndex := nextMediaIndex(tweetMediaCount, downloadUsername, item.TweetID)
		filename := buildMediaFilename(item, downloadUsername, mediaIndex)
		relativePath := buildDownloadRelativePath(rootSubdirectory, downloadUsername, item.Type, filename)

		if _, err := insertStmt.Exec(
			summary.FetchKey,
			entryKey,
			relativePath,
			downloadUsername,
			strings.TrimSpace(item.URL),
			strings.TrimSpace(row.TweetID),
			strings.TrimSpace(item.Type),
			updatedAt,
		); err != nil {
			return err
		}
	}

	return rows.Err()
}

func rebuildDownloadMediaIndexForTweetIDsTx(
	tx *sql.Tx,
	scope FetchScopeRecord,
	fetchKey string,
	fallbackUsername string,
	tweetIDs []string,
	updatedAt time.Time,
) error {
	if len(tweetIDs) == 0 {
		return nil
	}

	rootSubdirectory := scopeRootSubdirectory(scope)
	seen := make(map[string]struct{}, len(tweetIDs))
	for _, rawTweetID := range tweetIDs {
		tweetID := strings.TrimSpace(rawTweetID)
		if tweetID == "" {
			continue
		}
		if _, exists := seen[tweetID]; exists {
			continue
		}
		seen[tweetID] = struct{}{}

		if _, err := tx.Exec(`
			DELETE FROM download_media_index
			WHERE fetch_key = ? AND tweet_id = ?
		`, fetchKey, tweetID); err != nil {
			return err
		}

		rows, err := tx.Query(`
			SELECT
				entry_key,
				url,
				date_value,
				tweet_id,
				type,
				content,
				author_username,
				original_filename,
				entry_json
			FROM account_timeline_items
			WHERE fetch_key = ? AND tweet_id = ?
			ORDER BY date_unix_ms DESC, tweet_id_num DESC, entry_key ASC
		`, fetchKey, tweetID)
		if err != nil {
			return err
		}

		insertStmt, err := tx.Prepare(`
			INSERT INTO download_media_index (
				fetch_key, entry_key, relative_path, download_username, url, tweet_id, media_type, updated_at
			)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?)
			ON CONFLICT(fetch_key, entry_key) DO UPDATE SET
				relative_path = excluded.relative_path,
				download_username = excluded.download_username,
				url = excluded.url,
				tweet_id = excluded.tweet_id,
				media_type = excluded.media_type,
				updated_at = excluded.updated_at
		`)
		if err != nil {
			rows.Close()
			return err
		}

		tweetMediaCount := make(map[string]map[int64]int)
		for rows.Next() {
			var entryKey string
			var row timelineMediaProjection
			if err := rows.Scan(
				&entryKey,
				&row.URL,
				&row.Date,
				&row.TweetID,
				&row.Type,
				&row.Content,
				&row.AuthorUsername,
				&row.OriginalFilename,
				&row.EntryJSON,
			); err != nil {
				insertStmt.Close()
				rows.Close()
				return err
			}

			item, ok := buildMediaItemFromProjection(row, fallbackUsername)
			if !ok {
				continue
			}

			downloadUsername := resolveDownloadUsername(item, fallbackUsername)
			if downloadUsername == "" {
				continue
			}
			mediaIndex := nextMediaIndex(tweetMediaCount, downloadUsername, item.TweetID)
			filename := buildMediaFilename(item, downloadUsername, mediaIndex)
			relativePath := buildDownloadRelativePath(rootSubdirectory, downloadUsername, item.Type, filename)

			if _, err := insertStmt.Exec(
				fetchKey,
				entryKey,
				relativePath,
				downloadUsername,
				strings.TrimSpace(item.URL),
				strings.TrimSpace(row.TweetID),
				strings.TrimSpace(item.Type),
				updatedAt,
			); err != nil {
				insertStmt.Close()
				rows.Close()
				return err
			}
		}

		err = rows.Err()
		insertStmt.Close()
		rows.Close()
		if err != nil {
			return err
		}
	}

	return nil
}
