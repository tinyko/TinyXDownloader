package backend

import (
	"database/sql"
	"strings"
)

const accountSummarySelectQuery = `
	SELECT
		id,
		username,
		name,
		profile_image,
		COALESCE(account_info_json, ''),
		total_media,
		last_fetched,
		COALESCE(response_json, ''),
		COALESCE(media_type, 'all'),
		COALESCE(timeline_type, 'timeline'),
		COALESCE(retweets, 0),
		COALESCE(query_key, ''),
		COALESCE(cursor, ''),
		COALESCE(completed, 1),
		COALESCE(followers_count, 0),
		COALESCE(statuses_count, 0),
		fetch_key,
		COALESCE(storage_version, 1)
	FROM accounts
`

type accountSummaryScanner interface {
	Scan(dest ...any) error
}

func scanAccountSummary(scanner accountSummaryScanner) (*accountSummaryRecord, error) {
	var summary accountSummaryRecord
	var lastFetchedValue any
	var retweetsInt int
	var completedInt int

	err := scanner.Scan(
		&summary.ID,
		&summary.Username,
		&summary.Name,
		&summary.ProfileImage,
		&summary.AccountInfoJSON,
		&summary.TotalMedia,
		&lastFetchedValue,
		&summary.ResponseJSON,
		&summary.MediaType,
		&summary.TimelineType,
		&retweetsInt,
		&summary.QueryKey,
		&summary.Cursor,
		&completedInt,
		&summary.FollowersCount,
		&summary.StatusesCount,
		&summary.FetchKey,
		&summary.StorageVersion,
	)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}

	lastFetched, err := parseDBTimeValue(lastFetchedValue)
	if err != nil {
		return nil, err
	}

	summary.LastFetched = lastFetched
	summary.Retweets = retweetsInt == 1
	summary.Completed = completedInt == 1

	return &summary, nil
}

func queryAccountSummary(query string, args ...any) (*accountSummaryRecord, error) {
	return scanAccountSummary(db.QueryRow(query, args...))
}

func getAccountSummaryByFetchKey(fetchKey string) (*accountSummaryRecord, error) {
	return queryAccountSummary(accountSummarySelectQuery+` WHERE fetch_key = ?`, fetchKey)
}

func getAccountSummaryByID(id int64) (*accountSummaryRecord, error) {
	return queryAccountSummary(accountSummarySelectQuery+` WHERE id = ?`, id)
}

func getAccountSummariesByFetchKeys(fetchKeys []string) ([]accountSummaryRecord, error) {
	if len(fetchKeys) == 0 {
		return []accountSummaryRecord{}, nil
	}

	placeholders := make([]string, 0, len(fetchKeys))
	args := make([]any, 0, len(fetchKeys))
	for _, fetchKey := range fetchKeys {
		trimmed := strings.TrimSpace(fetchKey)
		if trimmed == "" {
			continue
		}
		placeholders = append(placeholders, "?")
		args = append(args, trimmed)
	}
	if len(placeholders) == 0 {
		return []accountSummaryRecord{}, nil
	}

	rows, err := db.Query(accountSummarySelectQuery+` WHERE fetch_key IN (`+strings.Join(placeholders, ", ")+`)`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	summaries := make([]accountSummaryRecord, 0, len(placeholders))
	for rows.Next() {
		summary, err := scanAccountSummary(rows)
		if err != nil {
			return nil, err
		}
		if summary == nil {
			continue
		}
		summaries = append(summaries, *summary)
	}

	if err := rows.Err(); err != nil {
		return nil, err
	}

	return summaries, nil
}
