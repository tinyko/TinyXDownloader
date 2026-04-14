package backend

import (
	"fmt"
	"strings"
	"time"
)

const (
	defaultSavedAccountsPageLimit = 100
	maxSavedAccountsPageLimit     = 200
)

func normalizeSavedAccountsPageLimit(limit int) int {
	if limit <= 0 {
		return defaultSavedAccountsPageLimit
	}
	if limit > maxSavedAccountsPageLimit {
		return maxSavedAccountsPageLimit
	}
	return limit
}

func normalizeSavedAccountsPageOffset(offset int) int {
	if offset < 0 {
		return 0
	}
	return offset
}

func buildSavedAccountsWhereClause(
	accountViewMode string,
	searchQuery string,
	filterGroup string,
	filterMediaType string,
) (string, []interface{}) {
	clauses := make([]string, 0, 4)
	args := make([]interface{}, 0, 6)

	switch strings.TrimSpace(accountViewMode) {
	case "private":
		clauses = append(clauses, "LOWER(username) IN ('bookmarks', 'likes')")
	default:
		clauses = append(clauses, "LOWER(username) NOT IN ('bookmarks', 'likes')")
	}

	normalizedQuery := strings.ToLower(strings.TrimSpace(searchQuery))
	if normalizedQuery != "" {
		pattern := "%" + normalizedQuery + "%"
		clauses = append(clauses, "(LOWER(username) LIKE ? OR LOWER(name) LIKE ?)")
		args = append(args, pattern, pattern)
	}

	if strings.TrimSpace(accountViewMode) != "private" {
		switch strings.TrimSpace(filterGroup) {
		case "", "all":
		case "ungrouped":
			clauses = append(clauses, "COALESCE(group_name, '') = ''")
		default:
			clauses = append(clauses, "COALESCE(group_name, '') = ?")
			args = append(args, filterGroup)
		}

		switch strings.TrimSpace(filterMediaType) {
		case "", "all":
		case "all-media":
			clauses = append(clauses, "COALESCE(media_type, 'all') = 'all'")
		default:
			clauses = append(clauses, "COALESCE(media_type, 'all') = ?")
			args = append(args, filterMediaType)
		}
	}

	if len(clauses) == 0 {
		return "", args
	}
	return " WHERE " + strings.Join(clauses, " AND "), args
}

func buildSavedAccountsSortClause(sortOrder string) string {
	switch strings.TrimSpace(sortOrder) {
	case "oldest":
		return "last_fetched ASC, id ASC"
	case "username-asc":
		return "LOWER(username) ASC, id ASC"
	case "username-desc":
		return "LOWER(username) DESC, id DESC"
	case "followers-high":
		return "COALESCE(followers_count, 0) DESC, id DESC"
	case "followers-low":
		return "COALESCE(followers_count, 0) ASC, id ASC"
	case "posts-high":
		return "COALESCE(statuses_count, 0) DESC, id DESC"
	case "posts-low":
		return "COALESCE(statuses_count, 0) ASC, id ASC"
	case "media-high":
		return "COALESCE(total_media, 0) DESC, id DESC"
	case "media-low":
		return "COALESCE(total_media, 0) ASC, id ASC"
	case "newest", "":
		fallthrough
	default:
		return "last_fetched DESC, id DESC"
	}
}

func scanAccountListItem(scanner interface {
	Scan(dest ...interface{}) error
}) (AccountListItem, error) {
	var item AccountListItem
	var lastFetched time.Time
	var retweetsInt int
	var completedInt int
	err := scanner.Scan(
		&item.ID,
		&item.Username,
		&item.Name,
		&item.ProfileImage,
		&item.TotalMedia,
		&lastFetched,
		&item.GroupName,
		&item.GroupColor,
		&item.MediaType,
		&item.TimelineType,
		&retweetsInt,
		&item.QueryKey,
		&item.Cursor,
		&completedInt,
		&item.FollowersCount,
		&item.StatusesCount,
	)
	if err != nil {
		return AccountListItem{}, err
	}

	item.LastFetched = lastFetched.Format("2006-01-02 15:04")
	item.Retweets = retweetsInt == 1
	item.Completed = completedInt == 1
	return item, nil
}

func querySavedAccountsPageItems(
	accountViewMode string,
	searchQuery string,
	filterGroup string,
	filterMediaType string,
	sortOrder string,
	offset int,
	limit int,
) ([]AccountListItem, error) {
	whereClause, whereArgs := buildSavedAccountsWhereClause(
		accountViewMode,
		searchQuery,
		filterGroup,
		filterMediaType,
	)
	sortClause := buildSavedAccountsSortClause(sortOrder)
	args := append(whereArgs, limit, offset)

	rows, err := db.Query(`
		SELECT id, username, name, profile_image, total_media, last_fetched,
		       COALESCE(group_name, '') as group_name, COALESCE(group_color, '') as group_color,
		       COALESCE(media_type, 'all') as media_type,
		       COALESCE(timeline_type, 'timeline') as timeline_type,
		       COALESCE(retweets, 0) as retweets,
		       COALESCE(query_key, '') as query_key,
		       COALESCE(cursor, '') as cursor, COALESCE(completed, 1) as completed,
		       COALESCE(followers_count, 0) as followers_count,
		       COALESCE(statuses_count, 0) as statuses_count
		FROM accounts`+whereClause+`
		ORDER BY `+sortClause+`
		LIMIT ? OFFSET ?
	`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := make([]AccountListItem, 0, limit)
	for rows.Next() {
		item, err := scanAccountListItem(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func querySavedAccountsTotalCount(
	accountViewMode string,
	searchQuery string,
	filterGroup string,
	filterMediaType string,
) (int, error) {
	whereClause, whereArgs := buildSavedAccountsWhereClause(
		accountViewMode,
		searchQuery,
		filterGroup,
		filterMediaType,
	)

	var total int
	if err := db.QueryRow(
		`SELECT COUNT(*) FROM accounts`+whereClause,
		whereArgs...,
	).Scan(&total); err != nil {
		return 0, err
	}
	return total, nil
}

func querySavedAccountRefs() ([]SavedAccountRef, error) {
	rows, err := db.Query(`SELECT id, username FROM accounts ORDER BY id ASC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	refs := make([]SavedAccountRef, 0)
	for rows.Next() {
		var ref SavedAccountRef
		if err := rows.Scan(&ref.ID, &ref.Username); err != nil {
			return nil, err
		}
		refs = append(refs, ref)
	}
	return refs, rows.Err()
}

func querySavedAccountViewCounts() (int, int, error) {
	var publicCount int
	var privateCount int
	err := db.QueryRow(`
		SELECT
			COALESCE(SUM(CASE WHEN LOWER(username) NOT IN ('bookmarks', 'likes') THEN 1 ELSE 0 END), 0),
			COALESCE(SUM(CASE WHEN LOWER(username) IN ('bookmarks', 'likes') THEN 1 ELSE 0 END), 0)
		FROM accounts
	`).Scan(&publicCount, &privateCount)
	if err != nil {
		return 0, 0, err
	}
	return publicCount, privateCount, nil
}

func GetSavedAccountsBootstrap() (*SavedAccountsBootstrap, error) {
	if db == nil {
		if err := InitDB(); err != nil {
			return nil, err
		}
	}

	groupMaps, err := GetAllGroups()
	if err != nil {
		return nil, err
	}

	groups := make([]GroupInfo, 0, len(groupMaps))
	for _, group := range groupMaps {
		groups = append(groups, GroupInfo{
			Name:  group["name"],
			Color: group["color"],
		})
	}

	publicCount, privateCount, err := querySavedAccountViewCounts()
	if err != nil {
		return nil, err
	}

	accountRefs, err := querySavedAccountRefs()
	if err != nil {
		return nil, err
	}

	return &SavedAccountsBootstrap{
		Groups:       groups,
		PublicCount:  publicCount,
		PrivateCount: privateCount,
		AccountRefs:  accountRefs,
	}, nil
}

func GetSavedAccountsQueryPage(
	accountViewMode string,
	searchQuery string,
	filterGroup string,
	filterMediaType string,
	sortOrder string,
	offset int,
	limit int,
) (*SavedAccountsQueryPage, error) {
	if db == nil {
		if err := InitDB(); err != nil {
			return nil, err
		}
	}

	normalizedOffset := normalizeSavedAccountsPageOffset(offset)
	normalizedLimit := normalizeSavedAccountsPageLimit(limit)

	totalCount, err := querySavedAccountsTotalCount(
		accountViewMode,
		searchQuery,
		filterGroup,
		filterMediaType,
	)
	if err != nil {
		return nil, err
	}

	items, err := querySavedAccountsPageItems(
		accountViewMode,
		searchQuery,
		filterGroup,
		filterMediaType,
		sortOrder,
		normalizedOffset,
		normalizedLimit,
	)
	if err != nil {
		return nil, err
	}

	nextOffset := normalizedOffset + len(items)
	return &SavedAccountsQueryPage{
		Items:      items,
		TotalCount: totalCount,
		HasMore:    nextOffset < totalCount,
		NextOffset: nextOffset,
	}, nil
}

func GetSavedAccountMatchingIDs(
	accountViewMode string,
	searchQuery string,
	filterGroup string,
	filterMediaType string,
) ([]int64, error) {
	if db == nil {
		if err := InitDB(); err != nil {
			return nil, err
		}
	}

	whereClause, whereArgs := buildSavedAccountsWhereClause(
		accountViewMode,
		searchQuery,
		filterGroup,
		filterMediaType,
	)

	rows, err := db.Query(`SELECT id FROM accounts`+whereClause+` ORDER BY id ASC`, whereArgs...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	ids := make([]int64, 0)
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}

func GetAccountsByIDs(ids []int64) ([]AccountListItem, error) {
	if db == nil {
		if err := InitDB(); err != nil {
			return nil, err
		}
	}
	if len(ids) == 0 {
		return []AccountListItem{}, nil
	}

	placeholders := make([]string, 0, len(ids))
	args := make([]interface{}, 0, len(ids))
	for _, id := range ids {
		placeholders = append(placeholders, "?")
		args = append(args, id)
	}

	rows, err := db.Query(`
		SELECT id, username, name, profile_image, total_media, last_fetched,
		       COALESCE(group_name, '') as group_name, COALESCE(group_color, '') as group_color,
		       COALESCE(media_type, 'all') as media_type,
		       COALESCE(timeline_type, 'timeline') as timeline_type,
		       COALESCE(retweets, 0) as retweets,
		       COALESCE(query_key, '') as query_key,
		       COALESCE(cursor, '') as cursor, COALESCE(completed, 1) as completed,
		       COALESCE(followers_count, 0) as followers_count,
		       COALESCE(statuses_count, 0) as statuses_count
		FROM accounts
		WHERE id IN (`+strings.Join(placeholders, ",")+`)
	`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	itemsByID := make(map[int64]AccountListItem, len(ids))
	for rows.Next() {
		item, err := scanAccountListItem(rows)
		if err != nil {
			return nil, err
		}
		itemsByID[item.ID] = item
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	items := make([]AccountListItem, 0, len(ids))
	for _, id := range ids {
		if item, ok := itemsByID[id]; ok {
			items = append(items, item)
		}
	}
	return items, nil
}

func mustGetSavedAccountsQueryPage(
	accountViewMode string,
	searchQuery string,
	filterGroup string,
	filterMediaType string,
	sortOrder string,
	offset int,
	limit int,
) *SavedAccountsQueryPage {
	page, err := GetSavedAccountsQueryPage(
		accountViewMode,
		searchQuery,
		filterGroup,
		filterMediaType,
		sortOrder,
		offset,
		limit,
	)
	if err != nil {
		panic(fmt.Sprintf("unexpected saved accounts query error: %v", err))
	}
	return page
}

func mustGetAccountsByIDs(ids []int64) []AccountListItem {
	items, err := GetAccountsByIDs(ids)
	if err != nil {
		panic(fmt.Sprintf("unexpected GetAccountsByIDs error: %v", err))
	}
	return items
}
