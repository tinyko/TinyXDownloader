package backend

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"
	"time"
)

func saveAccountSnapshotChunkTx(
	tx *sql.Tx,
	scope FetchScopeRecord,
	accountInfo AccountInfo,
	entries []TimelineEntry,
	cursor string,
	completed bool,
	totalMedia int,
	lastFetched time.Time,
) error {
	normalizedScope := normalizeFetchScopeRecord(scope)
	if totalMedia < 0 {
		totalMedia = 0
	}

	username := strings.TrimSpace(accountInfo.Name)
	if username == "" {
		username = normalizedScope.Username
	}
	displayName := strings.TrimSpace(accountInfo.Nick)
	profileImage := strings.TrimSpace(accountInfo.ProfileImage)
	fetchKey := buildFetchKeyFromScope(normalizedScope)
	accountInfoJSON, err := json.Marshal(accountInfo)
	if err != nil {
		return err
	}

	completedInt := 0
	if completed {
		completedInt = 1
	}
	retweetsInt := 0
	if normalizedScope.Retweets {
		retweetsInt = 1
	}

	if _, err := tx.Exec(`
		INSERT INTO accounts (
			username, name, profile_image, total_media, last_fetched,
			account_info_json,
			media_type, timeline_type, retweets, query_key,
			followers_count, statuses_count, fetch_key, cursor, completed, storage_version
		)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 2)
		ON CONFLICT(fetch_key) DO UPDATE SET
			username = excluded.username,
			name = excluded.name,
			profile_image = excluded.profile_image,
			total_media = excluded.total_media,
			last_fetched = excluded.last_fetched,
			account_info_json = excluded.account_info_json,
			media_type = excluded.media_type,
			timeline_type = excluded.timeline_type,
			retweets = excluded.retweets,
			query_key = excluded.query_key,
			followers_count = excluded.followers_count,
			statuses_count = excluded.statuses_count,
			cursor = excluded.cursor,
			completed = excluded.completed,
			storage_version = 2
	`, username, displayName, profileImage, totalMedia, lastFetched, string(accountInfoJSON), normalizedScope.MediaType, normalizedScope.TimelineType, retweetsInt, normalizedScope.QueryKey, accountInfo.FollowersCount, accountInfo.StatusesCount, fetchKey, cursor, completedInt); err != nil {
		return err
	}

	if len(entries) == 0 {
		return nil
	}

	stmt, err := tx.Prepare(`
		INSERT INTO account_timeline_items (
			fetch_key, entry_key, url, tweet_id, type, date_value, date_unix_ms, tweet_id_num,
			content, author_username, original_filename, entry_json
		)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(fetch_key, entry_key) DO NOTHING
	`)
	if err != nil {
		return err
	}
	defer stmt.Close()

	updatedTweetIDs := make([]string, 0, len(entries))
	for _, entry := range entries {
		entryJSON, err := json.Marshal(entry)
		if err != nil {
			return err
		}

		if _, err := stmt.Exec(
			fetchKey,
			buildTimelineEntryStorageKey(entry),
			strings.TrimSpace(entry.URL),
			fmt.Sprintf("%d", int64(entry.TweetID)),
			strings.TrimSpace(entry.Type),
			strings.TrimSpace(entry.Date),
			parseTimelineEntryDateUnixMs(entry.Date),
			int64(entry.TweetID),
			strings.TrimSpace(entry.Content),
			strings.TrimSpace(entry.AuthorUsername),
			strings.TrimSpace(entry.OriginalFilename),
			string(entryJSON),
		); err != nil {
			return err
		}
		updatedTweetIDs = append(updatedTweetIDs, fmt.Sprintf("%d", int64(entry.TweetID)))
	}

	return rebuildDownloadMediaIndexForTweetIDsTx(
		tx,
		normalizedScope,
		fetchKey,
		strings.TrimSpace(accountInfo.Name),
		updatedTweetIDs,
		lastFetched,
	)
}

func SaveAccountSnapshotChunk(scope FetchScopeRecord, accountInfo AccountInfo, entries []TimelineEntry, cursor string, completed bool, totalMedia int) error {
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

	if err := saveAccountSnapshotChunkTx(tx, scope, accountInfo, entries, cursor, completed, totalMedia, time.Now()); err != nil {
		return err
	}

	return tx.Commit()
}

func SaveAccountResponseStructured(scope FetchScopeRecord, response TwitterResponse) error {
	totalMedia := response.TotalURLs
	if totalMedia == 0 && len(response.Timeline) > 0 {
		totalMedia = len(response.Timeline)
	}

	cursor := strings.TrimSpace(response.Cursor)
	if cursor == "" {
		cursor = strings.TrimSpace(response.Metadata.Cursor)
	}

	completed := response.Completed || response.Metadata.Completed
	return SaveAccountSnapshotChunk(scope, response.AccountInfo, response.Timeline, cursor, completed, totalMedia)
}
