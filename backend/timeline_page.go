package backend

import (
	"fmt"
	"strings"
)

const (
	defaultTimelinePageLimit = 120
	maxTimelinePageLimit     = 200
)

type TimelineMediaCounts struct {
	Photo int `json:"photo"`
	Video int `json:"video"`
	GIF   int `json:"gif"`
	Text  int `json:"text"`
}

type AccountTimelinePage struct {
	Summary     AccountSnapshotSummary `json:"summary"`
	MediaCounts TimelineMediaCounts    `json:"media_counts"`
	Items       []SavedTimelineItem    `json:"items"`
	TotalItems  int                    `json:"total_items"`
	HasMore     bool                   `json:"has_more"`
	NextOffset  int                    `json:"next_offset"`
}

type SavedTimelineItem struct {
	URL              string `json:"url"`
	Date             string `json:"date"`
	TweetID          string `json:"tweet_id"`
	Type             string `json:"type"`
	Content          string `json:"content,omitempty"`
	AuthorUsername   string `json:"author_username,omitempty"`
	OriginalFilename string `json:"original_filename,omitempty"`
}

func normalizeTimelinePageLimit(limit int) int {
	if limit <= 0 {
		return defaultTimelinePageLimit
	}
	if limit > maxTimelinePageLimit {
		return maxTimelinePageLimit
	}
	return limit
}

func normalizeTimelinePageOffset(offset int) int {
	if offset < 0 {
		return 0
	}
	return offset
}

func buildTimelineFilterClause(filterType string) (string, []interface{}) {
	switch strings.TrimSpace(filterType) {
	case "", "all":
		return "", nil
	case "photo":
		return " AND type = ?", []interface{}{"photo"}
	case "video":
		return " AND type = ?", []interface{}{"video"}
	case "gif":
		return " AND type IN (?, ?)", []interface{}{"gif", "animated_gif"}
	case "text":
		return " AND type = ?", []interface{}{"text"}
	default:
		return "", nil
	}
}

func buildTimelineSortClause(sortBy string) string {
	switch strings.TrimSpace(sortBy) {
	case "date-asc":
		return "date_unix_ms ASC, tweet_id_num ASC, entry_key ASC"
	case "tweet-id-desc":
		return "tweet_id_num DESC, date_unix_ms DESC, entry_key ASC"
	case "tweet-id-asc":
		return "tweet_id_num ASC, date_unix_ms ASC, entry_key ASC"
	case "date-desc", "":
		fallthrough
	default:
		return "date_unix_ms DESC, tweet_id_num DESC, entry_key ASC"
	}
}

func queryTimelineMediaCounts(fetchKey string) (TimelineMediaCounts, error) {
	rows, err := db.Query(`
		SELECT type, COUNT(*)
		FROM account_timeline_items
		WHERE fetch_key = ?
		GROUP BY type
	`, fetchKey)
	if err != nil {
		return TimelineMediaCounts{}, err
	}
	defer rows.Close()

	var counts TimelineMediaCounts
	for rows.Next() {
		var mediaType string
		var count int
		if err := rows.Scan(&mediaType, &count); err != nil {
			return TimelineMediaCounts{}, err
		}
		switch strings.TrimSpace(mediaType) {
		case "photo":
			counts.Photo += count
		case "video":
			counts.Video += count
		case "gif", "animated_gif":
			counts.GIF += count
		case "text":
			counts.Text += count
		}
	}

	return counts, rows.Err()
}

func GetAccountTimelinePage(
	scope FetchScopeRecord,
	offset int,
	limit int,
	filterType string,
	sortBy string,
) (*AccountTimelinePage, error) {
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

	pageSummary := buildStructuredSummary(summary)
	if pageSummary == nil {
		return nil, nil
	}

	mediaCounts, err := queryTimelineMediaCounts(summary.FetchKey)
	if err != nil {
		return nil, err
	}

	normalizedOffset := normalizeTimelinePageOffset(offset)
	normalizedLimit := normalizeTimelinePageLimit(limit)
	filterClause, filterArgs := buildTimelineFilterClause(filterType)
	sortClause := buildTimelineSortClause(sortBy)

	totalArgs := append([]interface{}{summary.FetchKey}, filterArgs...)
	var totalItems int
	if err := db.QueryRow(`
		SELECT COUNT(*)
		FROM account_timeline_items
		WHERE fetch_key = ?`+filterClause,
		totalArgs...,
	).Scan(&totalItems); err != nil {
		return nil, err
	}

	pageArgs := append([]interface{}{summary.FetchKey}, filterArgs...)
	pageArgs = append(pageArgs, normalizedLimit, normalizedOffset)
	rows, err := db.Query(`
		SELECT
			url,
			date_value,
			tweet_id,
			type,
			content,
			author_username,
			original_filename,
			entry_json
		FROM account_timeline_items
		WHERE fetch_key = ?`+filterClause+`
		ORDER BY `+sortClause+`
		LIMIT ? OFFSET ?
	`, pageArgs...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := make([]SavedTimelineItem, 0, normalizedLimit)
	for rows.Next() {
		var row timelineMediaProjection
		if err := rows.Scan(
			&row.URL,
			&row.Date,
			&row.TweetID,
			&row.Type,
			&row.Content,
			&row.AuthorUsername,
			&row.OriginalFilename,
			&row.EntryJSON,
		); err != nil {
			return nil, err
		}

		item, ok := buildSavedTimelineItemFromProjection(row)
		if !ok {
			continue
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	nextOffset := normalizedOffset + len(items)
	return &AccountTimelinePage{
		Summary:     *pageSummary,
		MediaCounts: mediaCounts,
		Items:       items,
		TotalItems:  totalItems,
		HasMore:     nextOffset < totalItems,
		NextOffset:  nextOffset,
	}, nil
}

func mustGetAccountTimelinePage(
	scope FetchScopeRecord,
	offset int,
	limit int,
	filterType string,
	sortBy string,
) *AccountTimelinePage {
	page, err := GetAccountTimelinePage(scope, offset, limit, filterType, sortBy)
	if err != nil {
		panic(fmt.Sprintf("unexpected timeline page error: %v", err))
	}
	return page
}
