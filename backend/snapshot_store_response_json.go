package backend

import (
	"encoding/json"
	"strings"
)

type structuredResponseJSONEnvelope struct {
	AccountInfo AccountInfo       `json:"account_info"`
	TotalURLs   int               `json:"total_urls"`
	Timeline    []json.RawMessage `json:"timeline"`
	Metadata    ExtractMetadata   `json:"metadata"`
	Cursor      string            `json:"cursor,omitempty"`
	Completed   bool              `json:"completed,omitempty"`
}

func loadTimelineEntryRawJSONByFetchKey(fetchKey string) ([]json.RawMessage, error) {
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

	timeline := make([]json.RawMessage, 0)
	for rows.Next() {
		var entryJSON string
		if err := rows.Scan(&entryJSON); err != nil {
			return nil, err
		}
		if strings.TrimSpace(entryJSON) == "" {
			continue
		}
		timeline = append(timeline, json.RawMessage(entryJSON))
	}

	if err := rows.Err(); err != nil {
		return nil, err
	}

	return timeline, nil
}

func buildStructuredResponseJSONEnvelope(summary *accountSummaryRecord, timeline []json.RawMessage) structuredResponseJSONEnvelope {
	return structuredResponseJSONEnvelope{
		AccountInfo: decodeSummaryAccountInfo(summary),
		TotalURLs:   resolveStructuredTotalURLs(summary, len(timeline)),
		Timeline:    timeline,
		Metadata:    buildStructuredMetadata(summary),
		Cursor:      summary.Cursor,
		Completed:   summary.Completed,
	}
}

func marshalStructuredResponseBySummary(summary *accountSummaryRecord) (string, error) {
	if summary == nil {
		return "", nil
	}

	timeline, err := loadTimelineEntryRawJSONByFetchKey(summary.FetchKey)
	if err != nil {
		return "", err
	}

	responseJSON, err := json.Marshal(buildStructuredResponseJSONEnvelope(summary, timeline))
	if err != nil {
		return "", err
	}

	return string(responseJSON), nil
}
