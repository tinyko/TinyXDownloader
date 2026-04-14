package backend

import (
	"database/sql"
	"strings"
)

func GetAccountSnapshotSummaryStructured(username, mediaType, timelineType string, retweets bool, queryKey string) (*AccountSnapshotSummary, error) {
	if db == nil {
		if err := InitDB(); err != nil {
			return nil, err
		}
	}

	summary, err := getAccountSummaryByFetchKey(buildFetchKey(username, mediaType, timelineType, retweets, queryKey))
	if err != nil || summary == nil {
		return nil, err
	}

	if err := ensureSummaryMigrated(summary); err != nil {
		return nil, err
	}

	return buildStructuredSummary(summary), nil
}

func GetAccountSnapshotTweetIDs(scope FetchScopeRecord) ([]string, error) {
	if db == nil {
		if err := InitDB(); err != nil {
			return nil, err
		}
	}

	normalizedScope := normalizeFetchScopeRecord(scope)
	summary, err := getAccountSummaryByFetchKey(buildFetchKeyFromScope(normalizedScope))
	if err != nil || summary == nil {
		return nil, err
	}

	if err := ensureSummaryMigrated(summary); err != nil {
		return nil, err
	}

	rows, err := db.Query(`
		SELECT tweet_id
		FROM account_timeline_items
		WHERE fetch_key = ?
		GROUP BY tweet_id
		ORDER BY MAX(date_unix_ms) DESC, MAX(tweet_id_num) DESC, MIN(entry_key) ASC
	`, summary.FetchKey)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	tweetIDs := make([]string, 0)
	for rows.Next() {
		var tweetID string
		if err := rows.Scan(&tweetID); err != nil {
			return nil, err
		}
		if strings.TrimSpace(tweetID) == "" {
			continue
		}
		tweetIDs = append(tweetIDs, tweetID)
	}

	if err := rows.Err(); err != nil {
		return nil, err
	}

	return tweetIDs, nil
}

func GetAccountResponseByScopeStructured(username, mediaType, timelineType string, retweets bool, queryKey string) (*TwitterResponse, error) {
	if db == nil {
		if err := InitDB(); err != nil {
			return nil, err
		}
	}

	summary, err := getAccountSummaryByFetchKey(buildFetchKey(username, mediaType, timelineType, retweets, queryKey))
	if err != nil || summary == nil {
		return nil, err
	}

	if err := ensureSummaryMigrated(summary); err != nil {
		return nil, err
	}

	return loadStructuredResponseBySummary(summary)
}

func buildAccountDBFromSummary(summary *accountSummaryRecord) (*AccountDB, error) {
	if summary == nil {
		return nil, sql.ErrNoRows
	}

	if err := ensureSummaryMigrated(summary); err != nil {
		return nil, err
	}

	responseJSON, err := marshalStructuredResponseBySummary(summary)
	if err != nil {
		return nil, err
	}

	return &AccountDB{
		ID:             summary.ID,
		Username:       summary.Username,
		Name:           summary.Name,
		ProfileImage:   summary.ProfileImage,
		TotalMedia:     summary.TotalMedia,
		LastFetched:    summary.LastFetched,
		ResponseJSON:   responseJSON,
		MediaType:      summary.MediaType,
		TimelineType:   summary.TimelineType,
		Retweets:       summary.Retweets,
		QueryKey:       summary.QueryKey,
		Cursor:         summary.Cursor,
		Completed:      summary.Completed,
		FollowersCount: summary.FollowersCount,
		StatusesCount:  summary.StatusesCount,
	}, nil
}
