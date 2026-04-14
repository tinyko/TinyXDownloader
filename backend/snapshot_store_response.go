package backend

import (
	"encoding/json"
	"strings"
)

func decodeSummaryAccountInfo(summary *accountSummaryRecord) AccountInfo {
	accountInfo := AccountInfo{
		Name:           summary.Username,
		Nick:           summary.Name,
		ProfileImage:   summary.ProfileImage,
		FollowersCount: summary.FollowersCount,
		StatusesCount:  summary.StatusesCount,
	}
	if strings.TrimSpace(summary.AccountInfoJSON) != "" {
		var decoded AccountInfo
		if err := json.Unmarshal([]byte(summary.AccountInfoJSON), &decoded); err == nil {
			if decoded.Name == "" {
				decoded.Name = accountInfo.Name
			}
			if decoded.Nick == "" {
				decoded.Nick = accountInfo.Nick
			}
			if decoded.ProfileImage == "" {
				decoded.ProfileImage = accountInfo.ProfileImage
			}
			if decoded.FollowersCount == 0 {
				decoded.FollowersCount = accountInfo.FollowersCount
			}
			if decoded.StatusesCount == 0 {
				decoded.StatusesCount = accountInfo.StatusesCount
			}
			accountInfo = decoded
		}
	}
	return accountInfo
}

func buildStructuredSummary(summary *accountSummaryRecord) *AccountSnapshotSummary {
	if summary == nil {
		return nil
	}

	return &AccountSnapshotSummary{
		AccountInfo: decodeSummaryAccountInfo(summary),
		TotalURLs:   resolveStructuredTotalURLs(summary, 0),
		Cursor:      summary.Cursor,
		Completed:   summary.Completed,
	}
}

func resolveStructuredTotalURLs(summary *accountSummaryRecord, timelineLen int) int {
	totalURLs := summary.TotalMedia
	if totalURLs == 0 && timelineLen > 0 {
		totalURLs = timelineLen
	}
	return totalURLs
}

func buildStructuredMetadata(summary *accountSummaryRecord) ExtractMetadata {
	return ExtractMetadata{
		NewEntries: 0,
		Page:       0,
		BatchSize:  0,
		HasMore:    !summary.Completed,
		Cursor:     summary.Cursor,
		Completed:  summary.Completed,
	}
}
