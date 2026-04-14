package backend

import "encoding/json"

// loadTimelineEntriesByFetchKey is intentionally kept as a compatibility-path helper.
// Saved timeline pages and download payloads should continue to use projection readers.
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

func buildStructuredResponse(summary *accountSummaryRecord, timeline []TimelineEntry) *TwitterResponse {
	if summary == nil {
		return nil
	}

	return &TwitterResponse{
		AccountInfo: decodeSummaryAccountInfo(summary),
		TotalURLs:   resolveStructuredTotalURLs(summary, len(timeline)),
		Timeline:    timeline,
		Metadata:    buildStructuredMetadata(summary),
		Cursor:      summary.Cursor,
		Completed:   summary.Completed,
	}
}

func loadStructuredResponseBySummary(summary *accountSummaryRecord) (*TwitterResponse, error) {
	if summary == nil {
		return nil, nil
	}

	timeline, err := loadTimelineEntriesByFetchKey(summary.FetchKey)
	if err != nil {
		return nil, err
	}

	return buildStructuredResponse(summary, timeline), nil
}
