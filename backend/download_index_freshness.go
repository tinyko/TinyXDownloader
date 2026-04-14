package backend

import (
	"database/sql"
	"time"
)

type downloadMediaIndexFreshnessRecord struct {
	FetchKey         string
	LastFetched      time.Time
	TimelineCount    int
	IndexCount       int
	IndexUpdatedUnix sql.NullInt64
}

func listDownloadMediaIndexRepairFetchKeys() ([]string, error) {
	if db == nil {
		if err := InitDB(); err != nil {
			return nil, err
		}
	}

	rows, err := db.Query(`
		SELECT
			a.fetch_key,
			a.last_fetched,
			COALESCE(t.timeline_count, 0),
			COALESCE(i.index_count, 0),
			i.updated_unix
		FROM accounts a
		LEFT JOIN (
			SELECT fetch_key, COUNT(*) AS timeline_count
			FROM account_timeline_items
			GROUP BY fetch_key
		) t ON t.fetch_key = a.fetch_key
		LEFT JOIN (
			SELECT fetch_key, COUNT(*) AS index_count, CAST(MAX(strftime('%s', updated_at)) AS INTEGER) AS updated_unix
			FROM download_media_index
			GROUP BY fetch_key
		) i ON i.fetch_key = a.fetch_key
		ORDER BY a.last_fetched DESC
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	candidateKeys := make([]string, 0)
	for rows.Next() {
		var record downloadMediaIndexFreshnessRecord
		if err := rows.Scan(
			&record.FetchKey,
			&record.LastFetched,
			&record.TimelineCount,
			&record.IndexCount,
			&record.IndexUpdatedUnix,
		); err != nil {
			return nil, err
		}

		if record.TimelineCount == 0 {
			continue
		}
		if record.IndexCount == 0 || record.IndexCount != record.TimelineCount {
			candidateKeys = append(candidateKeys, record.FetchKey)
			continue
		}
		if !record.IndexUpdatedUnix.Valid || record.IndexUpdatedUnix.Int64 < record.LastFetched.Unix() {
			candidateKeys = append(candidateKeys, record.FetchKey)
		}
	}

	if err := rows.Err(); err != nil {
		return nil, err
	}

	return candidateKeys, nil
}
