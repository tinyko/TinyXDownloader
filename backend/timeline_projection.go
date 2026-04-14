package backend

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"strconv"
	"strings"
)

type resolvedTimelineProjection struct {
	URL              string
	Date             string
	TweetID          string
	Type             string
	Content          string
	AuthorUsername   string
	OriginalFilename string
}

type timelineProjectionHydrationRow struct {
	entryKey string
	row      timelineMediaProjection
}

func projectionNeedsEntryJSONFallback(row timelineMediaProjection) bool {
	return strings.TrimSpace(row.URL) == "" ||
		strings.TrimSpace(row.Date) == "" ||
		strings.TrimSpace(row.TweetID) == "" ||
		strings.TrimSpace(row.Type) == "" ||
		!row.Content.Valid ||
		!row.AuthorUsername.Valid ||
		!row.OriginalFilename.Valid
}

func resolveTimelineProjection(row timelineMediaProjection) (resolvedTimelineProjection, bool) {
	resolved := resolvedTimelineProjection{
		URL:     row.URL,
		Date:    row.Date,
		TweetID: row.TweetID,
		Type:    row.Type,
	}
	if row.Content.Valid {
		resolved.Content = row.Content.String
	}
	if row.AuthorUsername.Valid {
		resolved.AuthorUsername = row.AuthorUsername.String
	}
	if row.OriginalFilename.Valid {
		resolved.OriginalFilename = row.OriginalFilename.String
	}

	if projectionNeedsEntryJSONFallback(row) && strings.TrimSpace(row.EntryJSON) != "" {
		var entry TimelineEntry
		if err := json.Unmarshal([]byte(row.EntryJSON), &entry); err == nil {
			if strings.TrimSpace(resolved.URL) == "" {
				resolved.URL = entry.URL
			}
			if strings.TrimSpace(resolved.Date) == "" {
				resolved.Date = entry.Date
			}
			if strings.TrimSpace(resolved.TweetID) == "" && entry.TweetID != 0 {
				resolved.TweetID = strconv.FormatInt(int64(entry.TweetID), 10)
			}
			if strings.TrimSpace(resolved.Type) == "" {
				resolved.Type = entry.Type
			}
			if !row.Content.Valid {
				resolved.Content = entry.Content
			}
			if !row.AuthorUsername.Valid {
				resolved.AuthorUsername = entry.AuthorUsername
			}
			if !row.OriginalFilename.Valid {
				resolved.OriginalFilename = entry.OriginalFilename
			}
		}
	}

	if strings.TrimSpace(resolved.URL) == "" {
		return resolvedTimelineProjection{}, false
	}

	return resolved, true
}

func buildSavedTimelineItemFromProjection(row timelineMediaProjection) (SavedTimelineItem, bool) {
	resolved, ok := resolveTimelineProjection(row)
	if !ok {
		return SavedTimelineItem{}, false
	}

	return SavedTimelineItem{
		URL:              resolved.URL,
		Date:             resolved.Date,
		TweetID:          resolved.TweetID,
		Type:             resolved.Type,
		Content:          resolved.Content,
		AuthorUsername:   resolved.AuthorUsername,
		OriginalFilename: resolved.OriginalFilename,
	}, true
}

func buildMediaItemFromProjection(row timelineMediaProjection, fallbackUsername string) (MediaItem, bool) {
	resolved, ok := resolveTimelineProjection(row)
	if !ok {
		return MediaItem{}, false
	}

	tweetID, _ := strconv.ParseInt(strings.TrimSpace(resolved.TweetID), 10, 64)
	itemUsername := strings.TrimSpace(resolved.AuthorUsername)
	if itemUsername == "" {
		itemUsername = strings.TrimSpace(fallbackUsername)
	}

	return MediaItem{
		URL:              resolved.URL,
		Date:             resolved.Date,
		TweetID:          tweetID,
		Type:             resolved.Type,
		Username:         itemUsername,
		Content:          resolved.Content,
		OriginalFilename: resolved.OriginalFilename,
	}, true
}

func projectionNeedsHydration(row timelineMediaProjection) bool {
	return projectionNeedsEntryJSONFallback(row)
}

func ensureTimelineProjectionHydrated(fetchKey string) error {
	return hydrateTimelineProjectionEntryKeys(fetchKey, nil)
}

func hydrateTimelineProjectionEntryKeys(fetchKey string, entryKeys []string) error {
	toHydrate, err := loadTimelineProjectionHydrationRows(fetchKey, entryKeys)
	if err == sql.ErrNoRows || len(toHydrate) == 0 {
		return nil
	}
	if err != nil {
		return err
	}

	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	stmt, err := prepareTimelineProjectionHydrationStmt(tx)
	if err != nil {
		return err
	}
	defer stmt.Close()

	for _, item := range toHydrate {
		resolved, ok := resolveTimelineProjection(item.row)
		if !ok {
			continue
		}
		if _, err := stmt.Exec(
			resolved.URL,
			resolved.Date,
			resolved.TweetID,
			resolved.Type,
			resolved.Content,
			resolved.AuthorUsername,
			resolved.OriginalFilename,
			fetchKey,
			item.entryKey,
		); err != nil {
			return err
		}
	}

	return tx.Commit()
}

func prepareTimelineProjectionHydrationStmt(tx *sql.Tx) (*sql.Stmt, error) {
	return tx.Prepare(`
		UPDATE account_timeline_items
		SET
			url = ?,
			date_value = ?,
			tweet_id = ?,
			type = ?,
			content = ?,
			author_username = ?,
			original_filename = ?
		WHERE fetch_key = ? AND entry_key = ?
	`)
}

func loadTimelineProjectionHydrationRows(
	fetchKey string,
	entryKeys []string,
) ([]timelineProjectionHydrationRow, error) {
	query := `
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
		  AND entry_json != ''
		  AND (
			url = '' OR date_value = '' OR tweet_id = '' OR type = ''
			OR content IS NULL OR author_username IS NULL OR original_filename IS NULL
		  )
	`
	args := []any{fetchKey}

	if len(entryKeys) > 0 {
		placeholders := make([]string, 0, len(entryKeys))
		seen := make(map[string]struct{}, len(entryKeys))
		for _, rawEntryKey := range entryKeys {
			entryKey := strings.TrimSpace(rawEntryKey)
			if entryKey == "" {
				continue
			}
			if _, exists := seen[entryKey]; exists {
				continue
			}
			seen[entryKey] = struct{}{}
			placeholders = append(placeholders, "?")
			args = append(args, entryKey)
		}
		if len(placeholders) == 0 {
			return nil, nil
		}
		query += fmt.Sprintf(" AND entry_key IN (%s)", strings.Join(placeholders, ", "))
	}

	rows, err := db.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	toHydrate := make([]timelineProjectionHydrationRow, 0)
	for rows.Next() {
		var item timelineProjectionHydrationRow
		if err := rows.Scan(
			&item.entryKey,
			&item.row.URL,
			&item.row.Date,
			&item.row.TweetID,
			&item.row.Type,
			&item.row.Content,
			&item.row.AuthorUsername,
			&item.row.OriginalFilename,
			&item.row.EntryJSON,
		); err != nil {
			return nil, err
		}
		if !projectionNeedsHydration(item.row) {
			continue
		}
		toHydrate = append(toHydrate, item)
	}

	if err := rows.Err(); err != nil {
		return nil, err
	}

	return toHydrate, nil
}
