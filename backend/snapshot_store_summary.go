package backend

import (
	"database/sql"
	"encoding/json"
	"strings"
	"time"
)

func getAccountSummaryByFetchKey(fetchKey string) (*accountSummaryRecord, error) {
	var summary accountSummaryRecord
	var lastFetched time.Time
	var retweetsInt int
	var completedInt int

	err := db.QueryRow(`
		SELECT id, username, name, profile_image, COALESCE(account_info_json, ''), total_media, last_fetched, COALESCE(response_json, ''),
		       COALESCE(media_type, 'all'), COALESCE(timeline_type, 'timeline'),
		       COALESCE(retweets, 0), COALESCE(query_key, ''), COALESCE(cursor, ''),
		       COALESCE(completed, 1), COALESCE(followers_count, 0), COALESCE(statuses_count, 0),
		       fetch_key, COALESCE(storage_version, 1)
		FROM accounts
		WHERE fetch_key = ?
	`, fetchKey).Scan(
		&summary.ID,
		&summary.Username,
		&summary.Name,
		&summary.ProfileImage,
		&summary.AccountInfoJSON,
		&summary.TotalMedia,
		&lastFetched,
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

	summary.LastFetched = lastFetched
	summary.Retweets = retweetsInt == 1
	summary.Completed = completedInt == 1

	return &summary, nil
}

func getAccountSummaryByID(id int64) (*accountSummaryRecord, error) {
	var summary accountSummaryRecord
	var lastFetched time.Time
	var retweetsInt int
	var completedInt int

	err := db.QueryRow(`
		SELECT id, username, name, profile_image, COALESCE(account_info_json, ''), total_media, last_fetched, COALESCE(response_json, ''),
		       COALESCE(media_type, 'all'), COALESCE(timeline_type, 'timeline'),
		       COALESCE(retweets, 0), COALESCE(query_key, ''), COALESCE(cursor, ''),
		       COALESCE(completed, 1), COALESCE(followers_count, 0), COALESCE(statuses_count, 0),
		       fetch_key, COALESCE(storage_version, 1)
		FROM accounts
		WHERE id = ?
	`, id).Scan(
		&summary.ID,
		&summary.Username,
		&summary.Name,
		&summary.ProfileImage,
		&summary.AccountInfoJSON,
		&summary.TotalMedia,
		&lastFetched,
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

	summary.LastFetched = lastFetched
	summary.Retweets = retweetsInt == 1
	summary.Completed = completedInt == 1
	return &summary, nil
}

func ensureSummaryMigrated(summary *accountSummaryRecord) error {
	if summary == nil || summary.StorageVersion >= 2 {
		return nil
	}

	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	accountInfo := AccountInfo{
		Name:           summary.Username,
		Nick:           summary.Name,
		ProfileImage:   summary.ProfileImage,
		FollowersCount: summary.FollowersCount,
		StatusesCount:  summary.StatusesCount,
	}
	totalMedia := summary.TotalMedia
	cursor := summary.Cursor
	completed := summary.Completed
	var timeline []TimelineEntry

	if strings.TrimSpace(summary.ResponseJSON) != "" {
		convertedJSON, err := ConvertLegacyToNewFormat(summary.ResponseJSON)
		if err != nil {
			return err
		}

		var response TwitterResponse
		if err := json.Unmarshal([]byte(convertedJSON), &response); err != nil {
			return err
		}

		if response.AccountInfo.Name != "" {
			accountInfo = response.AccountInfo
		}
		if response.TotalURLs > 0 {
			totalMedia = response.TotalURLs
		} else if len(response.Timeline) > 0 {
			totalMedia = len(response.Timeline)
		}
		if response.Cursor != "" {
			cursor = response.Cursor
		} else if response.Metadata.Cursor != "" {
			cursor = response.Metadata.Cursor
		}
		completed = response.Completed || response.Metadata.Completed || summary.Completed
		timeline = response.Timeline
	}

	if err := saveAccountSnapshotChunkTx(tx, FetchScopeRecord{
		Username:     summary.Username,
		MediaType:    summary.MediaType,
		TimelineType: summary.TimelineType,
		Retweets:     summary.Retweets,
		QueryKey:     summary.QueryKey,
	}, accountInfo, timeline, cursor, completed, totalMedia, summary.LastFetched); err != nil {
		return err
	}

	if err := tx.Commit(); err != nil {
		return err
	}

	summary.StorageVersion = 2
	summary.Cursor = cursor
	summary.Completed = completed
	summary.TotalMedia = totalMedia
	summary.Name = accountInfo.Nick
	summary.ProfileImage = accountInfo.ProfileImage
	summary.FollowersCount = accountInfo.FollowersCount
	summary.StatusesCount = accountInfo.StatusesCount
	accountInfoJSON, err := json.Marshal(accountInfo)
	if err == nil {
		summary.AccountInfoJSON = string(accountInfoJSON)
	}
	return nil
}

func loadTimelineEntriesByFetchKey(fetchKey string) ([]TimelineEntry, error) {
	rows, err := db.Query(`
		SELECT entry_json
		FROM account_timeline_items
		WHERE fetch_key = ?
		ORDER BY date_unix_ms DESC, tweet_id_num DESC, entry_key ASC
	`, fetchKey)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	timeline := make([]TimelineEntry, 0)
	for rows.Next() {
		var entryJSON string
		if err := rows.Scan(&entryJSON); err != nil {
			return nil, err
		}

		var entry TimelineEntry
		if err := json.Unmarshal([]byte(entryJSON), &entry); err != nil {
			continue
		}
		timeline = append(timeline, entry)
	}

	if err := rows.Err(); err != nil {
		return nil, err
	}

	return timeline, nil
}

func decodeSummaryAccountInfo(summary *accountSummaryRecord) AccountInfo {
	accountInfo := AccountInfo{
		Name:           summary.Username,
		Nick:           summary.Name,
		ProfileImage:   summary.ProfileImage,
		FollowersCount: summary.FollowersCount,
		StatusesCount:  summary.StatusesCount,
	}
	if strings.TrimSpace(summary.AccountInfoJSON) != "" {
		var decoded AccountInfo
		if err := json.Unmarshal([]byte(summary.AccountInfoJSON), &decoded); err == nil {
			if decoded.Name == "" {
				decoded.Name = accountInfo.Name
			}
			if decoded.Nick == "" {
				decoded.Nick = accountInfo.Nick
			}
			if decoded.ProfileImage == "" {
				decoded.ProfileImage = accountInfo.ProfileImage
			}
			if decoded.FollowersCount == 0 {
				decoded.FollowersCount = accountInfo.FollowersCount
			}
			if decoded.StatusesCount == 0 {
				decoded.StatusesCount = accountInfo.StatusesCount
			}
			accountInfo = decoded
		}
	}
	return accountInfo
}

func buildStructuredSummary(summary *accountSummaryRecord) *AccountSnapshotSummary {
	if summary == nil {
		return nil
	}

	totalURLs := summary.TotalMedia
	return &AccountSnapshotSummary{
		AccountInfo: decodeSummaryAccountInfo(summary),
		TotalURLs:   totalURLs,
		Cursor:      summary.Cursor,
		Completed:   summary.Completed,
	}
}

func buildStructuredResponse(summary *accountSummaryRecord, timeline []TimelineEntry) *TwitterResponse {
	if summary == nil {
		return nil
	}

	accountInfo := decodeSummaryAccountInfo(summary)

	totalURLs := summary.TotalMedia
	if totalURLs == 0 && len(timeline) > 0 {
		totalURLs = len(timeline)
	}

	return &TwitterResponse{
		AccountInfo: accountInfo,
		TotalURLs:   totalURLs,
		Timeline:    timeline,
		Metadata: ExtractMetadata{
			NewEntries: 0,
			Page:       0,
			BatchSize:  0,
			HasMore:    !summary.Completed,
			Cursor:     summary.Cursor,
			Completed:  summary.Completed,
		},
		Cursor:    summary.Cursor,
		Completed: summary.Completed,
	}
}
