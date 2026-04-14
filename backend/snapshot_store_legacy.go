package backend

import (
	"encoding/json"
	"strings"
)

type migratedLegacySnapshotState struct {
	accountInfo AccountInfo
	totalMedia  int
	cursor      string
	completed   bool
	timeline    []TimelineEntry
}

func decodeLegacySnapshotResponse(responseJSON string) (*TwitterResponse, error) {
	if strings.TrimSpace(responseJSON) == "" {
		return nil, nil
	}

	convertedJSON, err := ConvertLegacyToNewFormat(responseJSON)
	if err != nil {
		return nil, err
	}

	var response TwitterResponse
	if err := json.Unmarshal([]byte(convertedJSON), &response); err != nil {
		return nil, err
	}

	return &response, nil
}

func buildMigratedLegacySnapshotState(summary *accountSummaryRecord, response *TwitterResponse) migratedLegacySnapshotState {
	state := migratedLegacySnapshotState{
		accountInfo: AccountInfo{
			Name:           summary.Username,
			Nick:           summary.Name,
			ProfileImage:   summary.ProfileImage,
			FollowersCount: summary.FollowersCount,
			StatusesCount:  summary.StatusesCount,
		},
		totalMedia: summary.TotalMedia,
		cursor:     summary.Cursor,
		completed:  summary.Completed,
	}

	if response == nil {
		return state
	}

	if response.AccountInfo.Name != "" {
		state.accountInfo = response.AccountInfo
	}
	if response.TotalURLs > 0 {
		state.totalMedia = response.TotalURLs
	} else if len(response.Timeline) > 0 {
		state.totalMedia = len(response.Timeline)
	}
	if response.Cursor != "" {
		state.cursor = response.Cursor
	} else if response.Metadata.Cursor != "" {
		state.cursor = response.Metadata.Cursor
	}
	state.completed = response.Completed || response.Metadata.Completed || summary.Completed
	state.timeline = response.Timeline

	return state
}

func applyMigratedLegacySnapshotState(summary *accountSummaryRecord, state migratedLegacySnapshotState) {
	summary.StorageVersion = 2
	summary.Cursor = state.cursor
	summary.Completed = state.completed
	summary.TotalMedia = state.totalMedia
	summary.Name = state.accountInfo.Nick
	summary.ProfileImage = state.accountInfo.ProfileImage
	summary.FollowersCount = state.accountInfo.FollowersCount
	summary.StatusesCount = state.accountInfo.StatusesCount
	accountInfoJSON, err := json.Marshal(state.accountInfo)
	if err == nil {
		summary.AccountInfoJSON = string(accountInfoJSON)
	}
}

func ensureSummaryMigrated(summary *accountSummaryRecord) error {
	if summary == nil || summary.StorageVersion >= 2 {
		return nil
	}

	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	response, err := decodeLegacySnapshotResponse(summary.ResponseJSON)
	if err != nil {
		return err
	}
	state := buildMigratedLegacySnapshotState(summary, response)

	if err := saveAccountSnapshotChunkTx(tx, FetchScopeRecord{
		Username:     summary.Username,
		MediaType:    summary.MediaType,
		TimelineType: summary.TimelineType,
		Retweets:     summary.Retweets,
		QueryKey:     summary.QueryKey,
	}, state.accountInfo, state.timeline, state.cursor, state.completed, state.totalMedia, summary.LastFetched); err != nil {
		return err
	}

	if err := tx.Commit(); err != nil {
		return err
	}

	applyMigratedLegacySnapshotState(summary, state)

	return nil
}
