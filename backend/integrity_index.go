package backend

import (
	"path/filepath"
	"strconv"
	"strings"
)

func loadTrackedMediaIndex(downloadPath string) (map[string]MediaItem, error) {
	tracked, pathsByFetchKey, err := loadTrackedMediaIndexRows(downloadPath, nil)
	if err != nil {
		return nil, err
	}

	candidateFetchKeys, err := listDownloadMediaIndexRepairFetchKeys()
	if err != nil {
		return nil, err
	}
	if len(candidateFetchKeys) == 0 {
		return tracked, nil
	}

	candidates, err := getAccountSummariesByFetchKeys(candidateFetchKeys)
	if err != nil {
		return nil, err
	}

	repairedFetchKeys := make([]string, 0, len(candidates))
	for _, summary := range candidates {
		summary := summary
		if err := ensureScopeDownloadMediaIndex(&summary); err != nil {
			continue
		}
		repairedFetchKeys = append(repairedFetchKeys, summary.FetchKey)
	}
	if len(repairedFetchKeys) == 0 {
		return tracked, nil
	}

	for _, fetchKey := range repairedFetchKeys {
		for _, path := range pathsByFetchKey[fetchKey] {
			delete(tracked, path)
		}
	}

	refreshed, _, err := loadTrackedMediaIndexRows(downloadPath, repairedFetchKeys)
	if err != nil {
		return nil, err
	}
	for path, item := range refreshed {
		tracked[path] = item
	}

	return tracked, nil
}

func loadTrackedMediaIndexRows(downloadPath string, fetchKeys []string) (map[string]MediaItem, map[string][]string, error) {
	query := `
		SELECT fetch_key, relative_path, url, tweet_id, media_type, download_username
		FROM download_media_index
	`
	args := make([]interface{}, 0, len(fetchKeys))
	if len(fetchKeys) > 0 {
		placeholders := make([]string, 0, len(fetchKeys))
		for _, fetchKey := range fetchKeys {
			trimmed := strings.TrimSpace(fetchKey)
			if trimmed == "" {
				continue
			}
			placeholders = append(placeholders, "?")
			args = append(args, trimmed)
		}
		if len(placeholders) == 0 {
			return map[string]MediaItem{}, map[string][]string{}, nil
		}
		query += ` WHERE fetch_key IN (` + strings.Join(placeholders, ", ") + `)`
	}

	rows, err := db.Query(query, args...)
	if err != nil {
		return nil, nil, err
	}
	defer rows.Close()

	tracked := make(map[string]MediaItem)
	pathsByFetchKey := make(map[string][]string)
	for rows.Next() {
		var fetchKey string
		var relativePath string
		var mediaURL string
		var tweetIDValue string
		var mediaType string
		var downloadUsername string
		if err := rows.Scan(
			&fetchKey,
			&relativePath,
			&mediaURL,
			&tweetIDValue,
			&mediaType,
			&downloadUsername,
		); err != nil {
			return nil, nil, err
		}

		tweetID, _ := strconv.ParseInt(strings.TrimSpace(tweetIDValue), 10, 64)
		outputPath := filepath.Clean(filepath.Join(downloadPath, relativePath))
		tracked[outputPath] = MediaItem{
			URL:      mediaURL,
			TweetID:  tweetID,
			Type:     mediaType,
			Username: downloadUsername,
		}
		pathsByFetchKey[fetchKey] = append(pathsByFetchKey[fetchKey], outputPath)
	}

	if err := rows.Err(); err != nil {
		return nil, nil, err
	}

	return tracked, pathsByFetchKey, nil
}
