package main

import (
	"encoding/json"
	"fmt"
	"twitterxmediabatchdownloader/backend"
)

func (a *App) ExtractTimeline(req TimelineRequest) (string, error) {
	if a.smoke != nil {
		return a.smoke.extractTimeline(req)
	}

	if req.Username == "" && req.TimelineType != "bookmarks" {
		return "", fmt.Errorf("username is required")
	}
	if req.AuthToken == "" {
		return "", fmt.Errorf("auth token is required")
	}

	response, err := backend.ExtractTimeline(backend.TimelineRequest{
		Username:     req.Username,
		AuthToken:    req.AuthToken,
		TimelineType: req.TimelineType,
		BatchSize:    req.BatchSize,
		Page:         req.Page,
		MediaType:    req.MediaType,
		Retweets:     req.Retweets,
		RequestID:    req.RequestID,
		Cursor:       req.Cursor,
	})
	if err != nil {
		return "", fmt.Errorf("failed to extract timeline: %v", err)
	}

	jsonData, err := json.MarshalIndent(response, "", "  ")
	if err != nil {
		return "", fmt.Errorf("failed to encode response: %v", err)
	}

	return string(jsonData), nil
}

func (a *App) ExtractTimelineStructured(req TimelineRequest) (*backend.TwitterResponse, error) {
	if a.smoke != nil {
		return a.smoke.extractTimelineStructured(req)
	}

	if req.Username == "" && req.TimelineType != "bookmarks" {
		return nil, fmt.Errorf("username is required")
	}
	if req.AuthToken == "" {
		return nil, fmt.Errorf("auth token is required")
	}

	response, err := backend.ExtractTimeline(backend.TimelineRequest{
		Username:     req.Username,
		AuthToken:    req.AuthToken,
		TimelineType: req.TimelineType,
		BatchSize:    req.BatchSize,
		Page:         req.Page,
		MediaType:    req.MediaType,
		Retweets:     req.Retweets,
		RequestID:    req.RequestID,
		Cursor:       req.Cursor,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to extract timeline: %v", err)
	}

	return response, nil
}

func (a *App) ExtractDateRange(req DateRangeRequest) (string, error) {
	if a.smoke != nil {
		return a.smoke.extractDateRange(req)
	}

	if req.Username == "" {
		return "", fmt.Errorf("username is required")
	}
	if req.AuthToken == "" {
		return "", fmt.Errorf("auth token is required")
	}
	if req.StartDate == "" {
		return "", fmt.Errorf("start date is required")
	}
	if req.EndDate == "" {
		return "", fmt.Errorf("end date is required")
	}

	response, err := backend.ExtractDateRange(backend.DateRangeRequest{
		Username:    req.Username,
		AuthToken:   req.AuthToken,
		StartDate:   req.StartDate,
		EndDate:     req.EndDate,
		MediaFilter: req.MediaFilter,
		Retweets:    req.Retweets,
		RequestID:   req.RequestID,
	})
	if err != nil {
		return "", fmt.Errorf("failed to extract date range: %v", err)
	}

	jsonData, err := json.MarshalIndent(response, "", "  ")
	if err != nil {
		return "", fmt.Errorf("failed to encode response: %v", err)
	}

	return string(jsonData), nil
}

func (a *App) ExtractDateRangeStructured(req DateRangeRequest) (*backend.TwitterResponse, error) {
	if a.smoke != nil {
		return a.smoke.extractDateRangeStructured(req)
	}

	if req.Username == "" {
		return nil, fmt.Errorf("username is required")
	}
	if req.AuthToken == "" {
		return nil, fmt.Errorf("auth token is required")
	}
	if req.StartDate == "" {
		return nil, fmt.Errorf("start date is required")
	}
	if req.EndDate == "" {
		return nil, fmt.Errorf("end date is required")
	}

	response, err := backend.ExtractDateRange(backend.DateRangeRequest{
		Username:    req.Username,
		AuthToken:   req.AuthToken,
		StartDate:   req.StartDate,
		EndDate:     req.EndDate,
		MediaFilter: req.MediaFilter,
		Retweets:    req.Retweets,
		RequestID:   req.RequestID,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to extract date range: %v", err)
	}

	return response, nil
}
