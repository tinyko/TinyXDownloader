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

type AccountTimelineBootstrap struct {
	Summary     AccountSnapshotSummary `json:"summary"`
	MediaCounts TimelineMediaCounts    `json:"media_counts"`
	TotalItems  int                    `json:"total_items"`
}

type AccountTimelineItemsPage struct {
	Items      []SavedTimelineItem `json:"items"`
	HasMore    bool                `json:"has_more"`
	NextOffset int                 `json:"next_offset"`
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

type timelinePageProjectionRow struct {
	entryKey string
	row      timelineMediaProjection
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

func queryTimelineTotalItems(fetchKey string, filterType string) (int, error) {
	filterClause, filterArgs := buildTimelineFilterClause(filterType)
	args := append([]interface{}{fetchKey}, filterArgs...)

	var totalItems int
	if err := db.QueryRow(`
		SELECT COUNT(*)
		FROM account_timeline_items
		WHERE fetch_key = ?`+filterClause,
		args...,
	).Scan(&totalItems); err != nil {
		return 0, err
	}

	return totalItems, nil
}

func queryTimelineItemsPageRows(
	fetchKey string,
	offset int,
	limit int,
	filterType string,
	sortBy string,
) ([]timelinePageProjectionRow, error) {
	filterClause, filterArgs := buildTimelineFilterClause(filterType)
	sortClause := buildTimelineSortClause(sortBy)

	args := append([]interface{}{fetchKey}, filterArgs...)
	args = append(args, limit, offset)

	rows, err := db.Query(`
		SELECT
			entry_key,
			url,
			date_value,
			tweet_id,
			type,
			content,
			author_username,
			original_filename
		FROM account_timeline_items
		WHERE fetch_key = ?`+filterClause+`
		ORDER BY `+sortClause+`
		LIMIT ? OFFSET ?
	`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := make([]timelinePageProjectionRow, 0, limit)
	for rows.Next() {
		var item timelinePageProjectionRow
		if err := rows.Scan(
			&item.entryKey,
			&item.row.URL,
			&item.row.Date,
			&item.row.TweetID,
			&item.row.Type,
			&item.row.Content,
			&item.row.AuthorUsername,
			&item.row.OriginalFilename,
		); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	return items, nil
}

func loadTimelinePageSummary(scope FetchScopeRecord) (*accountSummaryRecord, *AccountSnapshotSummary, error) {
	normalizedScope := normalizeFetchScopeRecord(scope)
	summary, err := getAccountSummaryByFetchKey(buildFetchKeyFromScope(normalizedScope))
	if err != nil || summary == nil {
		return nil, nil, err
	}

	if err := ensureSummaryMigrated(summary); err != nil {
		return nil, nil, err
	}

	pageSummary := buildStructuredSummary(summary)
	if pageSummary == nil {
		return nil, nil, nil
	}

	return summary, pageSummary, nil
}

func GetAccountTimelineBootstrap(
	scope FetchScopeRecord,
	filterType string,
) (*AccountTimelineBootstrap, error) {
	if db == nil {
		if err := InitDB(); err != nil {
			return nil, err
		}
	}

	summary, pageSummary, err := loadTimelinePageSummary(scope)
	if err != nil || summary == nil || pageSummary == nil {
		return nil, err
	}

	mediaCounts, err := queryTimelineMediaCounts(summary.FetchKey)
	if err != nil {
		return nil, err
	}
	totalItems, err := queryTimelineTotalItems(summary.FetchKey, filterType)
	if err != nil {
		return nil, err
	}

	return &AccountTimelineBootstrap{
		Summary:     *pageSummary,
		MediaCounts: mediaCounts,
		TotalItems:  totalItems,
	}, nil
}

func GetAccountTimelineItemsPage(
	scope FetchScopeRecord,
	offset int,
	limit int,
	filterType string,
	sortBy string,
) (*AccountTimelineItemsPage, error) {
	if db == nil {
		if err := InitDB(); err != nil {
			return nil, err
		}
	}

	summary, _, err := loadTimelinePageSummary(scope)
	if err != nil || summary == nil {
		return nil, err
	}

	normalizedOffset := normalizeTimelinePageOffset(offset)
	normalizedLimit := normalizeTimelinePageLimit(limit)
	totalItems, err := queryTimelineTotalItems(summary.FetchKey, filterType)
	if err != nil {
		return nil, err
	}
	pageRows, err := queryTimelineItemsPageRows(
		summary.FetchKey,
		normalizedOffset,
		normalizedLimit,
		filterType,
		sortBy,
	)
	if err != nil {
		return nil, err
	}
	entryKeysToHydrate := make([]string, 0)
	for _, item := range pageRows {
		if projectionNeedsHydration(item.row) {
			entryKeysToHydrate = append(entryKeysToHydrate, item.entryKey)
		}
	}
	if len(entryKeysToHydrate) > 0 {
		if err := hydrateTimelineProjectionEntryKeys(summary.FetchKey, entryKeysToHydrate); err != nil {
			return nil, err
		}
		pageRows, err = queryTimelineItemsPageRows(
			summary.FetchKey,
			normalizedOffset,
			normalizedLimit,
			filterType,
			sortBy,
		)
		if err != nil {
			return nil, err
		}
	}

	items := make([]SavedTimelineItem, 0, len(pageRows))
	for _, pageRow := range pageRows {
		item, ok := buildSavedTimelineItemFromProjection(pageRow.row)
		if !ok {
			continue
		}
		items = append(items, item)
	}

	nextOffset := normalizedOffset + len(items)
	return &AccountTimelineItemsPage{
		Items:      items,
		HasMore:    nextOffset < totalItems,
		NextOffset: nextOffset,
	}, nil
}

func GetAccountTimelinePage(
	scope FetchScopeRecord,
	offset int,
	limit int,
	filterType string,
	sortBy string,
) (*AccountTimelinePage, error) {
	bootstrap, err := GetAccountTimelineBootstrap(scope, filterType)
	if err != nil || bootstrap == nil {
		return nil, err
	}
	itemsPage, err := GetAccountTimelineItemsPage(scope, offset, limit, filterType, sortBy)
	if err != nil || itemsPage == nil {
		return nil, err
	}

	return &AccountTimelinePage{
		Summary:     bootstrap.Summary,
		MediaCounts: bootstrap.MediaCounts,
		Items:       itemsPage.Items,
		TotalItems:  bootstrap.TotalItems,
		HasMore:     itemsPage.HasMore,
		NextOffset:  itemsPage.NextOffset,
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
