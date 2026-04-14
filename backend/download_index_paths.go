package backend

import (
	"path/filepath"
	"strings"
)

const downloadMediaIndexTableSchema = `
	CREATE TABLE IF NOT EXISTS download_media_index (
		fetch_key TEXT NOT NULL,
		entry_key TEXT NOT NULL,
		relative_path TEXT NOT NULL,
		download_username TEXT NOT NULL,
		url TEXT NOT NULL,
		tweet_id TEXT NOT NULL,
		media_type TEXT NOT NULL,
		updated_at DATETIME NOT NULL,
		PRIMARY KEY (fetch_key, entry_key)
	)
`

func ensureDownloadMediaIndexSchema() error {
	if _, err := db.Exec(downloadMediaIndexTableSchema); err != nil {
		return err
	}
	if _, err := db.Exec(`
		CREATE INDEX IF NOT EXISTS idx_download_media_index_relative_path
		ON download_media_index(relative_path)
	`); err != nil {
		return err
	}
	if _, err := db.Exec(`
		CREATE INDEX IF NOT EXISTS idx_download_media_index_fetch_key
		ON download_media_index(fetch_key)
	`); err != nil {
		return err
	}
	return nil
}

func scopeRootSubdirectory(scope FetchScopeRecord) string {
	switch strings.TrimSpace(scope.Username) {
	case "bookmarks":
		return "My Bookmarks"
	case "likes":
		return "My Likes"
	default:
		return ""
	}
}

func buildDownloadRelativePath(rootSubdirectory, username, mediaType, filename string) string {
	parts := make([]string, 0, 4)
	if strings.TrimSpace(rootSubdirectory) != "" {
		parts = append(parts, rootSubdirectory)
	}
	if strings.TrimSpace(username) != "" {
		parts = append(parts, username)
	}
	parts = append(parts, mediaSubfolder(mediaType), filename)
	return filepath.Join(parts...)
}
