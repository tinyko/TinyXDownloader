package backend

import (
	"database/sql"
	"encoding/json"
)

// SaveAccount saves or updates an account in the database
func SaveAccount(username, name, profileImage string, totalMedia int, responseJSON string, mediaType string) error {
	return SaveAccountWithStatus(username, name, profileImage, totalMedia, responseJSON, mediaType, "timeline", false, "", "", true)
}

// SaveAccountWithStatus saves or updates an account with cursor and completion status
func SaveAccountWithStatus(username, name, profileImage string, totalMedia int, responseJSON string, mediaType string, timelineType string, retweets bool, queryKey string, cursor string, completed bool) error {
	if db == nil {
		if err := InitDB(); err != nil {
			return err
		}
	}

	convertedJSON, err := ConvertLegacyToNewFormat(responseJSON)
	if err != nil {
		return err
	}

	var response TwitterResponse
	if err := json.Unmarshal([]byte(convertedJSON), &response); err != nil {
		return err
	}

	if response.AccountInfo.Name == "" {
		response.AccountInfo.Name = username
	}
	if response.AccountInfo.Nick == "" {
		response.AccountInfo.Nick = name
	}
	if response.AccountInfo.ProfileImage == "" {
		response.AccountInfo.ProfileImage = profileImage
	}
	if response.TotalURLs == 0 && totalMedia > 0 {
		response.TotalURLs = totalMedia
	}
	if response.TotalURLs == 0 && len(response.Timeline) > 0 {
		response.TotalURLs = len(response.Timeline)
	}
	if response.Cursor == "" {
		response.Cursor = cursor
	}
	if response.Metadata.Cursor == "" {
		response.Metadata.Cursor = response.Cursor
	}
	response.Completed = completed
	response.Metadata.Completed = completed

	return SaveAccountResponseStructured(FetchScopeRecord{
		Username:     username,
		MediaType:    mediaType,
		TimelineType: timelineType,
		Retweets:     retweets,
		QueryKey:     queryKey,
	}, response)
}

// GetAllAccounts returns all saved accounts
func GetAllAccounts() ([]AccountListItem, error) {
	if db == nil {
		if err := InitDB(); err != nil {
			return nil, err
		}
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
			ORDER BY group_name ASC, last_fetched DESC
		`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var accounts []AccountListItem
	for rows.Next() {
		var acc AccountListItem
		var lastFetchedValue any
		var retweetsInt int
		var completedInt int
		if err := rows.Scan(&acc.ID, &acc.Username, &acc.Name, &acc.ProfileImage, &acc.TotalMedia, &lastFetchedValue, &acc.GroupName, &acc.GroupColor, &acc.MediaType, &acc.TimelineType, &retweetsInt, &acc.QueryKey, &acc.Cursor, &completedInt, &acc.FollowersCount, &acc.StatusesCount); err != nil {
			continue
		}
		lastFetched, err := parseDBTimeValue(lastFetchedValue)
		if err != nil {
			continue
		}
		acc.LastFetched = lastFetched.Format("2006-01-02 15:04")
		acc.Retweets = retweetsInt == 1
		acc.Completed = completedInt == 1

		accounts = append(accounts, acc)
	}

	return accounts, nil
}

// UpdateAccountGroup updates the group for an account
func UpdateAccountGroup(id int64, groupName, groupColor string) error {
	if db == nil {
		if err := InitDB(); err != nil {
			return err
		}
	}

	_, err := db.Exec("UPDATE accounts SET group_name = ?, group_color = ? WHERE id = ?", groupName, groupColor, id)
	return err
}

// GetAllGroups returns all unique groups
func GetAllGroups() ([]map[string]string, error) {
	if db == nil {
		if err := InitDB(); err != nil {
			return nil, err
		}
	}

	rows, err := db.Query(`
		SELECT DISTINCT group_name, group_color 
		FROM accounts 
		WHERE group_name != '' 
		ORDER BY group_name
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var groups []map[string]string
	for rows.Next() {
		var name, color string
		if err := rows.Scan(&name, &color); err != nil {
			continue
		}
		groups = append(groups, map[string]string{"name": name, "color": color})
	}

	return groups, nil
}

func GetSavedAccountsWorkspaceData() (*SavedAccountsWorkspaceData, error) {
	accounts, err := GetAllAccounts()
	if err != nil {
		return nil, err
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

	return &SavedAccountsWorkspaceData{
		Accounts: accounts,
		Groups:   groups,
	}, nil
}

// ClearAllAccounts deletes all accounts from the database
func ClearAllAccounts() error {
	if db == nil {
		if err := InitDB(); err != nil {
			return err
		}
	}

	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	if _, err := tx.Exec("DELETE FROM account_timeline_items"); err != nil {
		return err
	}
	if _, err := tx.Exec("DELETE FROM download_media_index"); err != nil {
		return err
	}
	if _, err := tx.Exec("DELETE FROM accounts"); err != nil {
		return err
	}

	return tx.Commit()
}

// GetAccountByID returns a specific account by ID
func GetAccountByID(id int64) (*AccountDB, error) {
	if db == nil {
		if err := InitDB(); err != nil {
			return nil, err
		}
	}

	summary, err := getAccountSummaryByID(id)
	if err != nil {
		return nil, err
	}
	if summary == nil {
		return nil, sql.ErrNoRows
	}

	return buildAccountDBFromSummary(summary)
}

// GetAccountResponseByScope returns the saved snapshot JSON for an exact fetch scope.
func GetAccountResponseByScope(username, mediaType, timelineType string, retweets bool, queryKey string) (string, error) {
	if db == nil {
		if err := InitDB(); err != nil {
			return "", err
		}
	}

	summary, err := getAccountSummaryByFetchKey(buildFetchKey(username, mediaType, timelineType, retweets, queryKey))
	if err != nil || summary == nil {
		return "", err
	}

	if err := ensureSummaryMigrated(summary); err != nil {
		return "", err
	}

	responseJSON, err := marshalStructuredResponseBySummary(summary)
	if err != nil {
		return "", err
	}

	return string(responseJSON), nil
}

// DeleteAccount deletes an account from the database
func DeleteAccount(id int64) error {
	if db == nil {
		if err := InitDB(); err != nil {
			return err
		}
	}

	summary, err := getAccountSummaryByID(id)
	if err != nil {
		return err
	}
	if summary == nil {
		return nil
	}

	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	if _, err := tx.Exec("DELETE FROM account_timeline_items WHERE fetch_key = ?", summary.FetchKey); err != nil {
		return err
	}
	if _, err := tx.Exec("DELETE FROM download_media_index WHERE fetch_key = ?", summary.FetchKey); err != nil {
		return err
	}
	if _, err := tx.Exec("DELETE FROM accounts WHERE id = ?", id); err != nil {
		return err
	}

	return tx.Commit()
}
