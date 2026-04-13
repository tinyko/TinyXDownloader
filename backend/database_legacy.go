package backend

import "encoding/json"

// LegacyMediaEntry represents media entry in old format
type LegacyMediaEntry struct {
	TweetID string `json:"tweet_id"`
	URL     string `json:"url"`
	Date    string `json:"date"`
	Type    string `json:"type"`
}

// LegacyAccountFormat represents the old saved account format
type LegacyAccountFormat struct {
	Username       string             `json:"username"`
	Nick           string             `json:"nick"`
	Followers      int                `json:"followers"`
	Following      int                `json:"following"`
	Posts          int                `json:"posts"`
	MediaType      string             `json:"media_type"`
	ProfileImage   string             `json:"profile_image"`
	FetchMode      string             `json:"fetch_mode"`
	FetchTimestamp string             `json:"fetch_timestamp"`
	GroupID        interface{}        `json:"group_id"`
	MediaList      []LegacyMediaEntry `json:"media_list"`
}

// ConvertLegacyToNewFormat converts old format to new TwitterResponse format
func ConvertLegacyToNewFormat(jsonStr string) (string, error) {
	var check map[string]interface{}
	if err := json.Unmarshal([]byte(jsonStr), &check); err != nil {
		return jsonStr, err
	}

	if _, hasAccountInfo := check["account_info"]; hasAccountInfo {
		return jsonStr, nil
	}

	if _, hasUsername := check["username"]; !hasUsername {
		return jsonStr, nil
	}
	if _, hasMediaList := check["media_list"]; !hasMediaList {
		return jsonStr, nil
	}

	var legacy LegacyAccountFormat
	if err := json.Unmarshal([]byte(jsonStr), &legacy); err != nil {
		return jsonStr, err
	}

	timeline := make([]map[string]interface{}, len(legacy.MediaList))
	for i, media := range legacy.MediaList {
		timeline[i] = map[string]interface{}{
			"url":        media.URL,
			"date":       media.Date,
			"tweet_id":   media.TweetID,
			"type":       media.Type,
			"is_retweet": false,
		}
	}

	newFormat := map[string]interface{}{
		"account_info": map[string]interface{}{
			"name":            legacy.Username,
			"nick":            legacy.Nick,
			"date":            "",
			"followers_count": legacy.Followers,
			"friends_count":   legacy.Following,
			"profile_image":   legacy.ProfileImage,
			"statuses_count":  legacy.Posts,
		},
		"total_urls": len(legacy.MediaList),
		"timeline":   timeline,
		"metadata": map[string]interface{}{
			"new_entries": len(legacy.MediaList),
			"page":        0,
			"batch_size":  0,
			"has_more":    false,
		},
	}

	newJSON, err := json.Marshal(newFormat)
	if err != nil {
		return jsonStr, err
	}

	return string(newJSON), nil
}
