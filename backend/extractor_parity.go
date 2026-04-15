package backend

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
)

const maxExtractorParityDiffs = 20

type ExtractorResponseSummary struct {
	TotalURLs     int            `json:"total_urls"`
	TimelineItems int            `json:"timeline_items"`
	Cursor        string         `json:"cursor,omitempty"`
	Completed     bool           `json:"completed"`
	AccountName   string         `json:"account_name,omitempty"`
	AccountNick   string         `json:"account_nick,omitempty"`
	EntryTypes    map[string]int `json:"entry_types,omitempty"`
}

type ExtractorParityReport struct {
	RequestKind   string                    `json:"request_kind"`
	PythonEngine  string                    `json:"python_engine"`
	GoEngine      string                    `json:"go_engine"`
	GoSupported   bool                      `json:"go_supported"`
	SupportReason string                    `json:"support_reason,omitempty"`
	PythonSuccess bool                      `json:"python_success"`
	GoSuccess     bool                      `json:"go_success"`
	Equal         bool                      `json:"equal"`
	Differences   []string                  `json:"differences,omitempty"`
	PythonSummary *ExtractorResponseSummary `json:"python_summary,omitempty"`
	GoSummary     *ExtractorResponseSummary `json:"go_summary,omitempty"`
	PythonError   string                    `json:"python_error,omitempty"`
	GoError       string                    `json:"go_error,omitempty"`
}

type extractorParityLogEntry struct {
	Event         string                    `json:"event"`
	RequestKind   string                    `json:"request_kind"`
	PythonEngine  string                    `json:"python_engine"`
	GoEngine      string                    `json:"go_engine"`
	GoSupported   bool                      `json:"go_supported"`
	SupportReason string                    `json:"support_reason,omitempty"`
	Username      string                    `json:"username,omitempty"`
	TimelineType  string                    `json:"timeline_type,omitempty"`
	MediaType     string                    `json:"media_type,omitempty"`
	Retweets      bool                      `json:"retweets,omitempty"`
	StartDate     string                    `json:"start_date,omitempty"`
	EndDate       string                    `json:"end_date,omitempty"`
	ElapsedMS     int64                     `json:"elapsed_ms"`
	Equal         bool                      `json:"equal"`
	Differences   []string                  `json:"differences,omitempty"`
	PythonSummary *ExtractorResponseSummary `json:"python_summary,omitempty"`
	GoSummary     *ExtractorResponseSummary `json:"go_summary,omitempty"`
	PythonError   string                    `json:"python_error,omitempty"`
	GoError       string                    `json:"go_error,omitempty"`
}

func summarizeTwitterResponse(response *TwitterResponse) *ExtractorResponseSummary {
	if response == nil {
		return nil
	}

	entryTypes := make(map[string]int)
	for _, entry := range response.Timeline {
		entryType := strings.TrimSpace(entry.Type)
		if entryType == "" {
			entryType = "unknown"
		}
		entryTypes[entryType]++
	}
	if len(entryTypes) == 0 {
		entryTypes = nil
	}

	return &ExtractorResponseSummary{
		TotalURLs:     response.TotalURLs,
		TimelineItems: len(response.Timeline),
		Cursor:        strings.TrimSpace(response.Cursor),
		Completed:     response.Completed,
		AccountName:   strings.TrimSpace(response.AccountInfo.Name),
		AccountNick:   strings.TrimSpace(response.AccountInfo.Nick),
		EntryTypes:    entryTypes,
	}
}

func CompareTimelineExtractorParity(req TimelineRequest) (*ExtractorParityReport, error) {
	goEngine := newGoTwitterEngine()
	goSupported, supportReason := timelineSupport(goEngine, req)
	report := &ExtractorParityReport{
		RequestKind:   "timeline",
		PythonEngine:  "retired",
		GoEngine:      goEngine.Name(),
		GoSupported:   goSupported,
		SupportReason: strings.TrimSpace(supportReason),
	}
	reason := retiredExtractorControlReason("timeline parity")
	report.PythonError = reason
	report.GoError = reason
	report.Differences = []string{reason}
	return report, retiredExtractorControlError("timeline parity")
}

func CompareDateRangeExtractorParity(req DateRangeRequest) (*ExtractorParityReport, error) {
	goEngine := newGoTwitterEngine()
	goSupported, supportReason := dateRangeSupport(goEngine, req)
	report := &ExtractorParityReport{
		RequestKind:   "date_range",
		PythonEngine:  "retired",
		GoEngine:      goEngine.Name(),
		GoSupported:   goSupported,
		SupportReason: strings.TrimSpace(supportReason),
	}
	reason := retiredExtractorControlReason("date-range parity")
	report.PythonError = reason
	report.GoError = reason
	report.Differences = []string{reason}
	return report, retiredExtractorControlError("date-range parity")
}

func runTimelineParityCandidate(
	ctx context.Context,
	engine ExtractorEngine,
	req TimelineRequest,
	supported bool,
	supportReason string,
) (*TwitterResponse, error) {
	if !supported {
		return nil, newEngineUnsupportedError(engine.Name(), supportReason)
	}
	return engine.ExtractTimeline(ctx, req)
}

func runDateRangeParityCandidate(
	ctx context.Context,
	engine ExtractorEngine,
	req DateRangeRequest,
	supported bool,
	supportReason string,
) (*TwitterResponse, error) {
	if !supported {
		return nil, newEngineUnsupportedError(engine.Name(), supportReason)
	}
	return engine.ExtractDateRange(ctx, req)
}

func appendExtractorParityLog(entry extractorParityLogEntry) {
	recordExtractorParityLogEntry(entry)
	data, err := json.Marshal(entry)
	if err != nil {
		return
	}
	_ = AppendBackendDiagnosticLog("info", string(data))
}

func compareTwitterResponses(
	pythonResponse *TwitterResponse,
	goResponse *TwitterResponse,
	pythonErr error,
	goErr error,
) []string {
	differences := make([]string, 0, 8)
	if pythonErr != nil {
		return appendDifference(differences, fmt.Sprintf("python engine error: %s", pythonErr.Error()))
	}
	if goErr != nil {
		return appendDifference(differences, fmt.Sprintf("go engine error: %s", goErr.Error()))
	}
	if pythonResponse == nil && goResponse == nil {
		return nil
	}
	if pythonResponse == nil {
		return appendDifference(differences, "python response is nil")
	}
	if goResponse == nil {
		return appendDifference(differences, "go response is nil")
	}

	if pythonResponse.TotalURLs != goResponse.TotalURLs {
		differences = appendDifference(differences, fmt.Sprintf("total_urls mismatch: python=%d go=%d", pythonResponse.TotalURLs, goResponse.TotalURLs))
	}
	if len(pythonResponse.Timeline) != len(goResponse.Timeline) {
		differences = appendDifference(differences, fmt.Sprintf("timeline length mismatch: python=%d go=%d", len(pythonResponse.Timeline), len(goResponse.Timeline)))
	}
	if strings.TrimSpace(pythonResponse.Cursor) != strings.TrimSpace(goResponse.Cursor) {
		differences = appendDifference(differences, fmt.Sprintf("cursor mismatch: python=%q go=%q", pythonResponse.Cursor, goResponse.Cursor))
	}
	if pythonResponse.Completed != goResponse.Completed {
		differences = appendDifference(differences, fmt.Sprintf("completed mismatch: python=%t go=%t", pythonResponse.Completed, goResponse.Completed))
	}

	differences = compareAccountInfo(differences, pythonResponse.AccountInfo, goResponse.AccountInfo)
	differences = compareMetadata(differences, pythonResponse.Metadata, goResponse.Metadata)

	limit := len(pythonResponse.Timeline)
	if len(goResponse.Timeline) < limit {
		limit = len(goResponse.Timeline)
	}
	for index := 0; index < limit && len(differences) < maxExtractorParityDiffs; index++ {
		pythonSignature := timelineEntrySignature(pythonResponse.Timeline[index])
		goSignature := timelineEntrySignature(goResponse.Timeline[index])
		if pythonSignature != goSignature {
			differences = appendDifference(differences, fmt.Sprintf("timeline[%d] mismatch", index))
		}
	}

	return differences
}

func compareAccountInfo(differences []string, pythonInfo AccountInfo, goInfo AccountInfo) []string {
	if strings.TrimSpace(pythonInfo.Name) != strings.TrimSpace(goInfo.Name) {
		differences = appendDifference(differences, fmt.Sprintf("account name mismatch: python=%q go=%q", pythonInfo.Name, goInfo.Name))
	}
	if strings.TrimSpace(pythonInfo.Nick) != strings.TrimSpace(goInfo.Nick) {
		differences = appendDifference(differences, fmt.Sprintf("account nick mismatch: python=%q go=%q", pythonInfo.Nick, goInfo.Nick))
	}
	if strings.TrimSpace(pythonInfo.ProfileImage) != strings.TrimSpace(goInfo.ProfileImage) {
		differences = appendDifference(differences, "account profile image mismatch")
	}
	if pythonInfo.FollowersCount != goInfo.FollowersCount {
		differences = appendDifference(differences, fmt.Sprintf("followers_count mismatch: python=%d go=%d", pythonInfo.FollowersCount, goInfo.FollowersCount))
	}
	if pythonInfo.FriendsCount != goInfo.FriendsCount {
		differences = appendDifference(differences, fmt.Sprintf("friends_count mismatch: python=%d go=%d", pythonInfo.FriendsCount, goInfo.FriendsCount))
	}
	if pythonInfo.StatusesCount != goInfo.StatusesCount {
		differences = appendDifference(differences, fmt.Sprintf("statuses_count mismatch: python=%d go=%d", pythonInfo.StatusesCount, goInfo.StatusesCount))
	}
	return differences
}

func compareMetadata(differences []string, pythonMeta ExtractMetadata, goMeta ExtractMetadata) []string {
	if pythonMeta.NewEntries != goMeta.NewEntries {
		differences = appendDifference(differences, fmt.Sprintf("metadata.new_entries mismatch: python=%d go=%d", pythonMeta.NewEntries, goMeta.NewEntries))
	}
	if pythonMeta.Page != goMeta.Page {
		differences = appendDifference(differences, fmt.Sprintf("metadata.page mismatch: python=%d go=%d", pythonMeta.Page, goMeta.Page))
	}
	if pythonMeta.BatchSize != goMeta.BatchSize {
		differences = appendDifference(differences, fmt.Sprintf("metadata.batch_size mismatch: python=%d go=%d", pythonMeta.BatchSize, goMeta.BatchSize))
	}
	if pythonMeta.HasMore != goMeta.HasMore {
		differences = appendDifference(differences, fmt.Sprintf("metadata.has_more mismatch: python=%t go=%t", pythonMeta.HasMore, goMeta.HasMore))
	}
	if strings.TrimSpace(pythonMeta.Cursor) != strings.TrimSpace(goMeta.Cursor) {
		differences = appendDifference(differences, fmt.Sprintf("metadata.cursor mismatch: python=%q go=%q", pythonMeta.Cursor, goMeta.Cursor))
	}
	if pythonMeta.Completed != goMeta.Completed {
		differences = appendDifference(differences, fmt.Sprintf("metadata.completed mismatch: python=%t go=%t", pythonMeta.Completed, goMeta.Completed))
	}
	return differences
}

func timelineEntrySignature(entry TimelineEntry) string {
	data, err := json.Marshal(entry)
	if err != nil {
		return fmt.Sprintf("%+v", entry)
	}
	return string(data)
}

func appendDifference(differences []string, difference string) []string {
	if len(differences) >= maxExtractorParityDiffs {
		return differences
	}
	return append(differences, difference)
}
