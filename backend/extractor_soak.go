package backend

import (
	"encoding/json"
	"os"
	"strings"
	"sync"
	"time"
)

const (
	extractorSoakReleaseRetentionLimit = 12
	extractorSoakRecentBlockerLimit    = 20
)

type ExtractorSoakBlockerEvent struct {
	Timestamp      string                 `json:"timestamp"`
	ReleaseVersion string                 `json:"release_version"`
	RequestKind    string                 `json:"request_kind"`
	RequestFamily  ExtractorRequestFamily `json:"request_family"`
	RequestTarget  string                 `json:"request_target"`
	SelectedEngine string                 `json:"selected_engine,omitempty"`
	FallbackCode   string                 `json:"fallback_code,omitempty"`
	Reason         string                 `json:"reason"`
}

type ExtractorSoakFamilyState struct {
	TotalRequests          int    `json:"total_requests"`
	GoSelectedSuccesses    int    `json:"go_selected_successes"`
	PythonFallbacks        int    `json:"python_fallbacks"`
	FallbackRequiredCount  int    `json:"fallback_required_count"`
	RuntimeFailures        int    `json:"runtime_failures"`
	CursorSemanticFailures int    `json:"cursor_semantic_failures"`
	LastSuccessAt          string `json:"last_success_at,omitempty"`
	LastFailureAt          string `json:"last_failure_at,omitempty"`
	LastFailureReason      string `json:"last_failure_reason,omitempty"`
	BlockerOpen            bool   `json:"blocker_open"`
}

type ExtractorSoakFamilyStates struct {
	Media     ExtractorSoakFamilyState `json:"media"`
	Timeline  ExtractorSoakFamilyState `json:"timeline"`
	DateRange ExtractorSoakFamilyState `json:"date_range"`
	Likes     ExtractorSoakFamilyState `json:"likes"`
	Bookmarks ExtractorSoakFamilyState `json:"bookmarks"`
}

type ExtractorSoakReleaseState struct {
	ReleaseVersion string                      `json:"release_version"`
	UpdatedAt      string                      `json:"updated_at,omitempty"`
	Families       ExtractorSoakFamilyStates   `json:"families"`
	RecentBlockers []ExtractorSoakBlockerEvent `json:"recent_blockers,omitempty"`
}

type ExtractorSoakState struct {
	CurrentReleaseVersion string                      `json:"current_release_version,omitempty"`
	Releases              []ExtractorSoakReleaseState `json:"releases,omitempty"`
}

type ExtractorDefaultRouteState struct {
	Promoted               bool   `json:"promoted"`
	BaselineActive         bool   `json:"baseline_active"`
	DefaultServedByGo      bool   `json:"default_served_by_go"`
	FallbackServedByPython bool   `json:"fallback_served_by_python"`
	InactiveReason         string `json:"inactive_reason,omitempty"`
	LastFailureReason      string `json:"last_failure_reason,omitempty"`
	DepythonizationReady   bool   `json:"depythonization_ready"`
}

type ExtractorDefaultRouteStates struct {
	Media     ExtractorDefaultRouteState `json:"media"`
	Timeline  ExtractorDefaultRouteState `json:"timeline"`
	DateRange ExtractorDefaultRouteState `json:"date_range"`
	Likes     ExtractorDefaultRouteState `json:"likes"`
	Bookmarks ExtractorDefaultRouteState `json:"bookmarks"`
}

var (
	extractorSoakMu sync.Mutex
	extractorAppMu  sync.RWMutex
	extractorAppVer string
)

func SetExtractorAppVersion(version string) {
	extractorAppMu.Lock()
	defer extractorAppMu.Unlock()
	extractorAppVer = strings.TrimSpace(version)
}

func currentExtractorAppVersion() string {
	extractorAppMu.RLock()
	defer extractorAppMu.RUnlock()
	if strings.TrimSpace(extractorAppVer) == "" {
		return "dev"
	}
	return strings.TrimSpace(extractorAppVer)
}

func extractorSoakStatePath() string {
	return ResolveAppDataPath("extractor_soak_state.json")
}

func defaultExtractorSoakFamilyStates() ExtractorSoakFamilyStates {
	return ExtractorSoakFamilyStates{}
}

func defaultExtractorSoakState() ExtractorSoakState {
	return ExtractorSoakState{Releases: []ExtractorSoakReleaseState{}}
}

func sanitizeExtractorSoakState(state ExtractorSoakState) ExtractorSoakState {
	state.CurrentReleaseVersion = strings.TrimSpace(state.CurrentReleaseVersion)
	if state.Releases == nil {
		state.Releases = []ExtractorSoakReleaseState{}
	}
	for index := range state.Releases {
		state.Releases[index].ReleaseVersion = strings.TrimSpace(state.Releases[index].ReleaseVersion)
		state.Releases[index].UpdatedAt = strings.TrimSpace(state.Releases[index].UpdatedAt)
		if state.Releases[index].RecentBlockers == nil {
			state.Releases[index].RecentBlockers = []ExtractorSoakBlockerEvent{}
		}
		for blockerIndex := range state.Releases[index].RecentBlockers {
			state.Releases[index].RecentBlockers[blockerIndex].Timestamp = strings.TrimSpace(state.Releases[index].RecentBlockers[blockerIndex].Timestamp)
			state.Releases[index].RecentBlockers[blockerIndex].ReleaseVersion = strings.TrimSpace(state.Releases[index].RecentBlockers[blockerIndex].ReleaseVersion)
			state.Releases[index].RecentBlockers[blockerIndex].RequestKind = strings.TrimSpace(state.Releases[index].RecentBlockers[blockerIndex].RequestKind)
			state.Releases[index].RecentBlockers[blockerIndex].RequestTarget = strings.TrimSpace(state.Releases[index].RecentBlockers[blockerIndex].RequestTarget)
			state.Releases[index].RecentBlockers[blockerIndex].SelectedEngine = strings.TrimSpace(state.Releases[index].RecentBlockers[blockerIndex].SelectedEngine)
			state.Releases[index].RecentBlockers[blockerIndex].FallbackCode = strings.TrimSpace(state.Releases[index].RecentBlockers[blockerIndex].FallbackCode)
			state.Releases[index].RecentBlockers[blockerIndex].Reason = strings.TrimSpace(state.Releases[index].RecentBlockers[blockerIndex].Reason)
		}
	}
	return state
}

func loadExtractorSoakState() (ExtractorSoakState, error) {
	state := defaultExtractorSoakState()
	raw, err := os.ReadFile(extractorSoakStatePath())
	if err != nil {
		if os.IsNotExist(err) {
			return state, nil
		}
		return state, err
	}
	if err := json.Unmarshal(raw, &state); err != nil {
		return defaultExtractorSoakState(), err
	}
	return sanitizeExtractorSoakState(state), nil
}

func saveExtractorSoakState(state ExtractorSoakState) error {
	if err := EnsureAppDataDir(); err != nil {
		return err
	}
	state = sanitizeExtractorSoakState(state)
	data, err := json.MarshalIndent(state, "", "  ")
	if err != nil {
		return err
	}
	data = append(data, '\n')
	return os.WriteFile(extractorSoakStatePath(), data, 0o600)
}

func extractorSoakFamilyStateByName(states ExtractorSoakFamilyStates, family ExtractorRequestFamily) ExtractorSoakFamilyState {
	switch family {
	case ExtractorRequestFamilyMedia:
		return states.Media
	case ExtractorRequestFamilyTimeline:
		return states.Timeline
	case ExtractorRequestFamilyDateRange:
		return states.DateRange
	case ExtractorRequestFamilyLikes:
		return states.Likes
	case ExtractorRequestFamilyBookmarks:
		return states.Bookmarks
	default:
		return ExtractorSoakFamilyState{}
	}
}

func assignExtractorSoakFamilyState(states *ExtractorSoakFamilyStates, family ExtractorRequestFamily, state ExtractorSoakFamilyState) {
	if states == nil {
		return
	}
	switch family {
	case ExtractorRequestFamilyMedia:
		states.Media = state
	case ExtractorRequestFamilyTimeline:
		states.Timeline = state
	case ExtractorRequestFamilyDateRange:
		states.DateRange = state
	case ExtractorRequestFamilyLikes:
		states.Likes = state
	case ExtractorRequestFamilyBookmarks:
		states.Bookmarks = state
	}
}

func findOrCreateExtractorSoakRelease(state *ExtractorSoakState, releaseVersion string) *ExtractorSoakReleaseState {
	if state == nil {
		return nil
	}
	releaseVersion = strings.TrimSpace(releaseVersion)
	for index := range state.Releases {
		if state.Releases[index].ReleaseVersion == releaseVersion {
			return &state.Releases[index]
		}
	}
	state.Releases = append([]ExtractorSoakReleaseState{{
		ReleaseVersion: releaseVersion,
		Families:       defaultExtractorSoakFamilyStates(),
		RecentBlockers: []ExtractorSoakBlockerEvent{},
	}}, state.Releases...)
	if len(state.Releases) > extractorSoakReleaseRetentionLimit {
		state.Releases = state.Releases[:extractorSoakReleaseRetentionLimit]
	}
	state.CurrentReleaseVersion = releaseVersion
	return &state.Releases[0]
}

func currentExtractorSoakReleaseState() (ExtractorSoakReleaseState, error) {
	state, err := loadExtractorSoakState()
	if err != nil {
		return ExtractorSoakReleaseState{Families: defaultExtractorSoakFamilyStates()}, err
	}
	releaseVersion := currentExtractorAppVersion()
	for _, release := range state.Releases {
		if strings.TrimSpace(release.ReleaseVersion) == releaseVersion {
			return release, nil
		}
	}
	return ExtractorSoakReleaseState{
		ReleaseVersion: releaseVersion,
		Families:       defaultExtractorSoakFamilyStates(),
		RecentBlockers: []ExtractorSoakBlockerEvent{},
	}, nil
}

func collectExtractorSoakBlockerEvents() ([]ExtractorSoakBlockerEvent, error) {
	release, err := currentExtractorSoakReleaseState()
	if err != nil {
		return nil, err
	}
	if release.RecentBlockers == nil {
		return []ExtractorSoakBlockerEvent{}, nil
	}
	return release.RecentBlockers, nil
}

func recordExtractorSoakRequest(entry extractorRequestLogEntry) {
	if !isExtractorSoakCandidate(entry) {
		return
	}

	extractorSoakMu.Lock()
	defer extractorSoakMu.Unlock()

	state, err := loadExtractorSoakState()
	if err != nil {
		return
	}
	releaseVersion := currentExtractorAppVersion()
	release := findOrCreateExtractorSoakRelease(&state, releaseVersion)
	if release == nil {
		return
	}

	now := extractorRunbookNow().UTC().Format(time.RFC3339)
	release.UpdatedAt = now
	familyState := extractorSoakFamilyStateByName(release.Families, entry.RequestFamily)
	familyState.TotalRequests++

	cursorIssue := validateSoakCursorSemantics(entry)
	blockerReason := ""

	if entry.Success && strings.TrimSpace(entry.SelectedEngine) == "go-twitter" && cursorIssue == "" {
		familyState.GoSelectedSuccesses++
		familyState.LastSuccessAt = now
	}

	if strings.TrimSpace(entry.SelectedEngine) != "go-twitter" {
		familyState.PythonFallbacks++
		if strings.TrimSpace(entry.FallbackCode) == "fallback_required" {
			familyState.FallbackRequiredCount++
		}
		blockerReason = firstNonEmpty(entry.FallbackReason, entry.FallbackCode, "default route served by python")
	}

	if !entry.Success {
		familyState.RuntimeFailures++
		blockerReason = firstNonEmpty(entry.Error, blockerReason, "runtime error")
	}

	if cursorIssue != "" {
		familyState.CursorSemanticFailures++
		blockerReason = cursorIssue
	}

	if blockerReason != "" {
		familyState.BlockerOpen = true
		familyState.LastFailureAt = now
		familyState.LastFailureReason = blockerReason
		release.RecentBlockers = append([]ExtractorSoakBlockerEvent{{
			Timestamp:      now,
			ReleaseVersion: releaseVersion,
			RequestKind:    strings.TrimSpace(entry.RequestKind),
			RequestFamily:  entry.RequestFamily,
			RequestTarget:  buildExtractorLogRequestTarget(entry.RequestKind, entry.Username, entry.TimelineType, entry.MediaType, entry.StartDate, entry.EndDate),
			SelectedEngine: strings.TrimSpace(entry.SelectedEngine),
			FallbackCode:   strings.TrimSpace(entry.FallbackCode),
			Reason:         blockerReason,
		}}, release.RecentBlockers...)
		if len(release.RecentBlockers) > extractorSoakRecentBlockerLimit {
			release.RecentBlockers = release.RecentBlockers[:extractorSoakRecentBlockerLimit]
		}
	}

	assignExtractorSoakFamilyState(&release.Families, entry.RequestFamily, familyState)
	_ = saveExtractorSoakState(state)
}

func isExtractorSoakCandidate(entry extractorRequestLogEntry) bool {
	if strings.TrimSpace(entry.Event) != "extractor_request" {
		return false
	}
	if entry.ModeSource == "live_validation" || entry.ModeSource == "rollout_policy" {
		return false
	}
	if strings.TrimSpace(entry.SelectedEngine) == "" {
		return false
	}
	switch entry.RequestFamily {
	case ExtractorRequestFamilyMedia, ExtractorRequestFamilyTimeline, ExtractorRequestFamilyDateRange,
		ExtractorRequestFamilyLikes, ExtractorRequestFamilyBookmarks:
		return true
	default:
		return false
	}
}

func validateSoakCursorSemantics(entry extractorRequestLogEntry) string {
	summary := entry.ResponseSummary
	if summary == nil {
		if entry.Success {
			return "successful default route request is missing response summary"
		}
		return ""
	}
	cursor := strings.TrimSpace(summary.Cursor)
	switch strings.TrimSpace(entry.RequestKind) {
	case "date_range":
		if cursor != "" {
			return "date-range default route returned a resume cursor"
		}
		if !summary.Completed {
			return "date-range default route did not complete in a single response"
		}
	default:
		if !summary.Completed && cursor == "" {
			return "default route returned incomplete results without a continuation cursor"
		}
	}
	return ""
}
