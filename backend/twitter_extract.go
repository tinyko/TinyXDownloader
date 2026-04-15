package backend

import (
	"context"
	"strings"
)

func shouldRetryAsGuest(authToken string, timelineType string, err error) bool {
	if err == nil || strings.TrimSpace(authToken) == "" {
		return false
	}

	lowerTimelineType := strings.ToLower(strings.TrimSpace(timelineType))
	if lowerTimelineType == "likes" || lowerTimelineType == "bookmarks" {
		return false
	}

	lowerErr := strings.ToLower(err.Error())
	return strings.Contains(lowerErr, "matching csrf cookie and header") ||
		strings.Contains(lowerErr, "csrf cookie and header") ||
		(strings.Contains(lowerErr, "403 forbidden") && strings.Contains(lowerErr, "csrf"))
}

func buildGuestExtractorArgs(args []string) []string {
	guestArgs := make([]string, 0, len(args))
	for i := 0; i < len(args); i++ {
		if args[i] == "--auth-token" {
			i++
			continue
		}
		if args[i] == "--guest" {
			continue
		}
		guestArgs = append(guestArgs, args[i])
	}
	return append(guestArgs, "--guest")
}

func ExtractTimeline(req TimelineRequest) (*TwitterResponse, error) {
	return extractTimelineWithEngines(
		context.Background(),
		req,
		currentExtractorEngineMode(),
		newGoTwitterEngine(),
		newGoTwitterEngine(),
	)
}

func ExtractDateRange(req DateRangeRequest) (*TwitterResponse, error) {
	return extractDateRangeWithEngines(
		context.Background(),
		req,
		currentExtractorEngineMode(),
		newGoTwitterEngine(),
		newGoTwitterEngine(),
	)
}
