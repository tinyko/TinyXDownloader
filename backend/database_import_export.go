package backend

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// ExportAccountToFile exports account JSON to a file
func ExportAccountToFile(id int64, outputDir string) (string, error) {
	acc, err := GetAccountByID(id)
	if err != nil {
		return "", err
	}

	exportDir := filepath.Join(outputDir, "twitterxmediabatchdownloader_backups")
	if err := os.MkdirAll(exportDir, 0755); err != nil {
		return "", err
	}

	filename := acc.Username
	if filename == "" {
		filename = acc.Name
	}
	filenameParts := []string{sanitizeFilenamePart(filename)}
	if mediaType := sanitizeFilenamePart(acc.MediaType); mediaType != "" {
		filenameParts = append(filenameParts, mediaType)
	}
	if timelineType := sanitizeFilenamePart(acc.TimelineType); timelineType != "" {
		filenameParts = append(filenameParts, timelineType)
	}
	if acc.Retweets {
		filenameParts = append(filenameParts, "retweets")
	}
	if queryKey := sanitizeFilenamePart(acc.QueryKey); queryKey != "" {
		filenameParts = append(filenameParts, queryKey)
	}
	filename = strings.Join(filenameParts, "_")

	filePath := filepath.Join(exportDir, filename+".json")

	if err := os.WriteFile(filePath, []byte(acc.ResponseJSON), 0644); err != nil {
		return "", err
	}

	return filePath, nil
}

// ExportAccountsToTXT exports selected accounts to TXT file (one username per line)
func ExportAccountsToTXT(ids []int64, outputDir string) (string, error) {
	if len(ids) == 0 {
		return "", fmt.Errorf("no accounts to export")
	}

	exportDir := filepath.Join(outputDir, "twitterxmediabatchdownloader_backups")
	if err := os.MkdirAll(exportDir, 0755); err != nil {
		return "", err
	}

	var usernames []string
	for _, id := range ids {
		acc, err := GetAccountByID(id)
		if err != nil {
			continue
		}
		if acc.Username != "" {
			usernames = append(usernames, acc.Username)
		}
	}

	if len(usernames) == 0 {
		return "", fmt.Errorf("no valid usernames found")
	}

	txtContent := ""
	for i, username := range usernames {
		if i > 0 {
			txtContent += "\n"
		}
		txtContent += username
	}

	filePath := filepath.Join(exportDir, "twitterxmediabatchdownloader_multiple.txt")

	if err := os.WriteFile(filePath, []byte(txtContent), 0644); err != nil {
		return "", err
	}

	return filePath, nil
}

// ImportAccountFromFile imports account from JSON file (supports both old and new format)
func ImportAccountFromFile(filePath string) (string, error) {
	if db == nil {
		if err := InitDB(); err != nil {
			return "", err
		}
	}

	data, err := os.ReadFile(filePath)
	if err != nil {
		return "", err
	}

	jsonStr := string(data)

	convertedJSON, err := ConvertLegacyToNewFormat(jsonStr)
	if err != nil {
		return "", err
	}

	var parsed map[string]interface{}
	if err := json.Unmarshal([]byte(convertedJSON), &parsed); err != nil {
		return "", err
	}

	accountInfo, ok := parsed["account_info"].(map[string]interface{})
	if !ok {
		return "", fmt.Errorf("invalid JSON format: missing account_info")
	}

	username, _ := accountInfo["name"].(string)
	name, _ := accountInfo["nick"].(string)
	profileImage, _ := accountInfo["profile_image"].(string)

	totalURLs := 0
	if total, ok := parsed["total_urls"].(float64); ok {
		totalURLs = int(total)
	}

	if username == "" {
		return "", fmt.Errorf("invalid JSON format: missing username")
	}

	err = SaveAccount(username, name, profileImage, totalURLs, convertedJSON, "all")
	if err != nil {
		return "", err
	}

	return username, nil
}
