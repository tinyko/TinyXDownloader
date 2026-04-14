package backend

import (
	"database/sql"
	"strings"
	"time"
)

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
	var maxUpdatedUnix sql.NullInt64
	if err := db.QueryRow(`
		SELECT COUNT(*), CAST(MAX(strftime('%s', updated_at)) AS INTEGER)
		FROM download_media_index
		WHERE fetch_key = ?
	`, summary.FetchKey).Scan(&indexCount, &maxUpdatedUnix); err != nil {
		return err
	}
	if indexCount == timelineCount && maxUpdatedUnix.Valid && maxUpdatedUnix.Int64 >= summary.LastFetched.Unix() {
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

	insertStmt, err := prepareDownloadMediaIndexInsertStmt(tx)
	if err != nil {
		return err
	}
	defer insertStmt.Close()

	return insertDownloadMediaIndexRows(rows, insertStmt, summary.FetchKey, rootSubdirectory, fallbackUsername, updatedAt)
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

		insertStmt, err := prepareDownloadMediaIndexInsertStmt(tx)
		if err != nil {
			rows.Close()
			return err
		}

		err = insertDownloadMediaIndexRows(rows, insertStmt, fetchKey, rootSubdirectory, fallbackUsername, updatedAt)
		insertStmt.Close()
		rows.Close()
		if err != nil {
			return err
		}
	}

	return nil
}

func prepareDownloadMediaIndexInsertStmt(tx *sql.Tx) (*sql.Stmt, error) {
	return tx.Prepare(`
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
}

func insertDownloadMediaIndexRows(
	rows *sql.Rows,
	insertStmt *sql.Stmt,
	fetchKey string,
	rootSubdirectory string,
	fallbackUsername string,
	updatedAt time.Time,
) error {
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
			fetchKey,
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
