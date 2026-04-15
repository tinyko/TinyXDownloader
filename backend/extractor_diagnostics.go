package backend

import (
	"os"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

const extractorDiagnosticsHistoryLimit = 20

type ExtractorSupportMatrixSummary struct {
	PublicMediaTypes            []string `json:"public_media_types"`
	PublicTimelineTypes         []string `json:"public_timeline_types"`
	PublicTimelineMediaTypes    []string `json:"public_timeline_media_types"`
	PublicDateRangeMediaFilters []string `json:"public_date_range_media_filters"`
	PrivateExplicitGoTimeline   []string `json:"private_explicit_go_timeline_types"`
	PrivateExplicitGoMediaTypes []string `json:"private_explicit_go_media_types"`
	PrivateAutoPinnedTimeline   []string `json:"private_auto_pinned_timeline_types"`
	RawSearchTimelineSupported  bool     `json:"raw_search_timeline_supported"`
}

type ExtractorRecentEvent struct {
	Timestamp      string                 `json:"timestamp"`
	Event          string                 `json:"event"`
	RequestKind    string                 `json:"request_kind,omitempty"`
	RequestFamily  ExtractorRequestFamily `json:"request_family,omitempty"`
	RequestTarget  string                 `json:"request_target,omitempty"`
	Username       string                 `json:"username,omitempty"`
	TimelineType   string                 `json:"timeline_type,omitempty"`
	MediaType      string                 `json:"media_type,omitempty"`
	Mode           ExtractorEngineMode    `json:"mode,omitempty"`
	ConfiguredMode ExtractorEngineMode    `json:"configured_mode,omitempty"`
	EffectiveMode  ExtractorEngineMode    `json:"effective_mode,omitempty"`
	ModeSource     string                 `json:"mode_source,omitempty"`
	SelectedEngine string                 `json:"selected_engine,omitempty"`
	Success        bool                   `json:"success"`
	FallbackReason string                 `json:"fallback_reason,omitempty"`
	FallbackCode   string                 `json:"fallback_code,omitempty"`
	AuthMode       string                 `json:"auth_mode,omitempty"`
	CursorPresent  bool                   `json:"cursor_present,omitempty"`
	PageItemCount  int                    `json:"page_item_count,omitempty"`
	MediaItemCount int                    `json:"media_item_count,omitempty"`
	TextItemCount  int                    `json:"text_item_count,omitempty"`
	MetadataCount  int                    `json:"metadata_count,omitempty"`
	PageCount      int                    `json:"page_count,omitempty"`
	TweetCount     int                    `json:"tweet_count,omitempty"`
	PartialParse   bool                   `json:"partial_parse,omitempty"`
	Stage          string                 `json:"stage,omitempty"`
	CursorStage    int                    `json:"cursor_stage,omitempty"`
	TrialArmed     bool                   `json:"trial_armed,omitempty"`
	TrialActive    bool                   `json:"trial_active,omitempty"`
	ElapsedMS      int64                  `json:"elapsed_ms,omitempty"`
	Error          string                 `json:"error,omitempty"`
}

type ExtractorParityHistoryEntry struct {
	Timestamp       string                    `json:"timestamp"`
	RequestKind     string                    `json:"request_kind"`
	Target          string                    `json:"target"`
	GoSupported     bool                      `json:"go_supported"`
	SupportReason   string                    `json:"support_reason,omitempty"`
	PythonSuccess   bool                      `json:"python_success"`
	GoSuccess       bool                      `json:"go_success"`
	Equal           bool                      `json:"equal"`
	DiffCount       int                       `json:"diff_count"`
	FirstDifference string                    `json:"first_difference,omitempty"`
	PythonSummary   *ExtractorResponseSummary `json:"python_summary,omitempty"`
	GoSummary       *ExtractorResponseSummary `json:"go_summary,omitempty"`
	PythonError     string                    `json:"python_error,omitempty"`
	GoError         string                    `json:"go_error,omitempty"`
}

type ExtractorDiagnosticsSnapshot struct {
	CurrentMode                  ExtractorEngineMode                    `json:"current_mode"`
	GoOnlyRuntime                bool                                   `json:"go_only_runtime"`
	HistoricalEvidenceOnly       bool                                   `json:"historical_evidence_only"`
	Phase7CutoverVersion         string                                 `json:"phase7_cutover_version,omitempty"`
	PrivateAutoPinned            bool                                   `json:"private_auto_pinned"`
	PrivateAutoPinnedReason      string                                 `json:"private_auto_pinned_reason,omitempty"`
	PythonFallbackAvailable      bool                                   `json:"python_fallback_available"`
	PythonFallbackBuildFlavor    string                                 `json:"python_fallback_build_flavor,omitempty"`
	AdHocParityAvailable         bool                                   `json:"ad_hoc_parity_available"`
	AdHocParityUnavailableReason string                                 `json:"ad_hoc_parity_unavailable_reason,omitempty"`
	PythonDeprecatedNotice       string                                 `json:"python_deprecated_notice,omitempty"`
	SupportMatrix                ExtractorSupportMatrixSummary          `json:"support_matrix"`
	Metrics                      ExtractorMetricsSnapshot               `json:"metrics"`
	RunbookConfig                ExtractorRunbookConfig                 `json:"runbook_config"`
	RolloutPolicy                ExtractorRolloutPolicy                 `json:"rollout_policy"`
	RecentValidationReports      []ExtractorValidationReportSummary     `json:"recent_validation_reports"`
	RecentLiveReports            []ExtractorLiveValidationReportSummary `json:"recent_live_reports"`
	PublicGate                   ExtractorValidationGate                `json:"public_gate"`
	PrivateGate                  ExtractorValidationGate                `json:"private_gate"`
	PublicFamilyGates            ExtractorPublicFamilyGates             `json:"public_family_gates"`
	PrivateFamilyGates           ExtractorPrivateFamilyGates            `json:"private_family_gates"`
	LiveFamilyGates              ExtractorLiveFamilyGates               `json:"live_family_gates"`
	PrivateLiveFamilyGates       ExtractorPrivateFamilyGates            `json:"private_live_family_gates"`
	PromotionFamilyGates         ExtractorPromotionFamilyGates          `json:"promotion_family_gates"`
	PrivatePromotionFamilyGates  ExtractorPrivateFamilyGates            `json:"private_promotion_family_gates"`
	PublicTrialStates            ExtractorPublicTrialStates             `json:"public_trial_states"`
	PrivateTrialStates           ExtractorPrivateTrialStates            `json:"private_trial_states"`
	PublicPromotionStates        ExtractorPublicPromotionStates         `json:"public_promotion_states"`
	PrivatePromotionStates       ExtractorPrivatePromotionStates        `json:"private_promotion_states"`
	DefaultRouteStates           ExtractorDefaultRouteStates            `json:"default_route_states"`
	SoakFamilyStates             ExtractorSoakFamilyStates              `json:"soak_family_states"`
	SoakReleaseVersion           string                                 `json:"soak_release_version,omitempty"`
	Phase7Ready                  bool                                   `json:"phase7_ready"`
	RecentEvents                 []ExtractorRecentEvent                 `json:"recent_events,omitempty"`
	RecentParity                 []ExtractorParityHistoryEntry          `json:"recent_parity,omitempty"`
}

var extractorDiagnosticsState struct {
	mu           sync.Mutex
	recentEvents []ExtractorRecentEvent
	recentParity []ExtractorParityHistoryEntry
}

func GetExtractorDiagnosticsSnapshot() ExtractorDiagnosticsSnapshot {
	currentMode := currentExtractorEngineMode()
	pythonFallback := currentPythonFallbackStatus()
	privateReason, privatePinned := "", false
	runbookConfig, err := loadExtractorRunbookConfig()
	if err != nil {
		runbookConfig = ExtractorRunbookConfig{Presets: []ExtractorRunbookPreset{}}
	}
	rolloutPolicy, err := loadExtractorRolloutPolicy()
	if err != nil {
		rolloutPolicy = defaultExtractorRolloutPolicy()
	}
	recentValidationReports, err := loadExtractorValidationReportSummaries(extractorValidationReportSnapshotSummaryLimit)
	if err != nil {
		recentValidationReports = []ExtractorValidationReportSummary{}
	}
	recentLiveReports, err := loadExtractorLiveValidationReportSummaries(extractorLiveValidationReportSnapshotSummaryLimit)
	if err != nil {
		recentLiveReports = []ExtractorLiveValidationReportSummary{}
	}
	publicGate, privateGate, publicFamilyGates, privateFamilyGates := resolveExtractorValidationGates(runbookConfig, recentValidationReports)
	liveFamilyGates, promotionFamilyGates, privateLiveFamilyGates, privatePromotionFamilyGates := resolveExtractorLiveValidationGates(runbookConfig, recentLiveReports)
	publicTrialStates := buildExtractorPublicTrialStates(rolloutPolicy, publicFamilyGates)
	privateTrialStates := buildExtractorPrivateTrialStates(rolloutPolicy, privateFamilyGates)
	publicPromotionStates := buildExtractorPublicPromotionStates(
		rolloutPolicy,
		promotionFamilyGates,
		runbookConfig.UpdatedAt,
	)
	privatePromotionStates := buildExtractorPrivatePromotionStates(
		rolloutPolicy,
		privatePromotionFamilyGates,
		runbookConfig.UpdatedAt,
	)
	soakRelease, err := currentExtractorSoakReleaseState()
	if err != nil {
		soakRelease = ExtractorSoakReleaseState{
			ReleaseVersion: currentExtractorAppVersion(),
			Families:       defaultExtractorSoakFamilyStates(),
			RecentBlockers: []ExtractorSoakBlockerEvent{},
		}
	}
	defaultRouteStates, phase7Ready := buildExtractorDefaultRouteStates(
		rolloutPolicy,
		publicPromotionStates,
		privatePromotionStates,
		publicFamilyGates,
		privateFamilyGates,
		liveFamilyGates,
		privateLiveFamilyGates,
		soakRelease,
	)

	extractorDiagnosticsState.mu.Lock()
	recentEvents := append([]ExtractorRecentEvent(nil), extractorDiagnosticsState.recentEvents...)
	recentParity := cloneExtractorParityHistory(extractorDiagnosticsState.recentParity)
	extractorDiagnosticsState.mu.Unlock()

	return ExtractorDiagnosticsSnapshot{
		CurrentMode:                  currentMode,
		GoOnlyRuntime:                true,
		HistoricalEvidenceOnly:       true,
		Phase7CutoverVersion:         currentExtractorAppVersion(),
		PrivateAutoPinned:            privatePinned,
		PrivateAutoPinnedReason:      privateReason,
		PythonFallbackAvailable:      pythonFallback.Available,
		PythonFallbackBuildFlavor:    pythonFallback.BuildFlavor,
		AdHocParityAvailable:         pythonFallback.AdHocParityAvailable,
		AdHocParityUnavailableReason: pythonFallback.UnavailableReason,
		PythonDeprecatedNotice:       buildExtractorPythonDeprecatedNotice(currentMode, pythonFallback),
		SupportMatrix:                buildExtractorSupportMatrixSummary(),
		Metrics:                      GetExtractorMetricsSnapshot(),
		RunbookConfig:                runbookConfig,
		RolloutPolicy:                rolloutPolicy,
		RecentValidationReports:      recentValidationReports,
		RecentLiveReports:            recentLiveReports,
		PublicGate:                   publicGate,
		PrivateGate:                  privateGate,
		PublicFamilyGates:            publicFamilyGates,
		PrivateFamilyGates:           privateFamilyGates,
		LiveFamilyGates:              liveFamilyGates,
		PrivateLiveFamilyGates:       privateLiveFamilyGates,
		PromotionFamilyGates:         promotionFamilyGates,
		PrivatePromotionFamilyGates:  privatePromotionFamilyGates,
		PublicTrialStates:            publicTrialStates,
		PrivateTrialStates:           privateTrialStates,
		PublicPromotionStates:        publicPromotionStates,
		PrivatePromotionStates:       privatePromotionStates,
		DefaultRouteStates:           defaultRouteStates,
		SoakFamilyStates:             soakRelease.Families,
		SoakReleaseVersion:           soakRelease.ReleaseVersion,
		Phase7Ready:                  phase7Ready,
		RecentEvents:                 recentEvents,
		RecentParity:                 recentParity,
	}
}

func buildExtractorSupportMatrixSummary() ExtractorSupportMatrixSummary {
	return ExtractorSupportMatrixSummary{
		PublicMediaTypes:            []string{"all", "image", "video", "gif"},
		PublicTimelineTypes:         []string{"timeline", "tweets", "with_replies"},
		PublicTimelineMediaTypes:    []string{"all", "image", "video", "gif", "text"},
		PublicDateRangeMediaFilters: []string{"all", "image", "video", "gif", "text"},
		PrivateExplicitGoTimeline:   []string{"likes", "bookmarks"},
		PrivateExplicitGoMediaTypes: []string{"all", "image", "video", "gif", "text"},
		PrivateAutoPinnedTimeline:   []string{},
		RawSearchTimelineSupported:  false,
	}
}

func recordExtractorRequestLogEntry(entry extractorRequestLogEntry) {
	requestKind := entry.RequestKind
	timelineType := entry.TimelineType
	requestTarget := buildExtractorLogRequestTarget(
		entry.RequestKind,
		entry.Username,
		entry.TimelineType,
		entry.MediaType,
		entry.StartDate,
		entry.EndDate,
	)
	fallbackReason := firstNonEmpty(entry.FallbackReason, entry.SupportReason)

	pushExtractorRecentEvent(ExtractorRecentEvent{
		Timestamp:      time.Now().UTC().Format(time.RFC3339),
		Event:          entry.Event,
		RequestKind:    requestKind,
		RequestFamily:  entry.RequestFamily,
		RequestTarget:  requestTarget,
		Username:       entry.Username,
		TimelineType:   timelineType,
		MediaType:      entry.MediaType,
		Mode:           entry.Mode,
		ConfiguredMode: entry.ConfiguredMode,
		EffectiveMode:  entry.EffectiveMode,
		ModeSource:     entry.ModeSource,
		SelectedEngine: entry.SelectedEngine,
		Success:        entry.Success,
		FallbackReason: fallbackReason,
		FallbackCode:   entry.FallbackCode,
		TrialArmed:     entry.TrialArmed,
		TrialActive:    entry.TrialActive,
		ElapsedMS:      entry.ElapsedMS,
		Error:          entry.Error,
	})
}

func recordExtractorParityLogEntry(entry extractorParityLogEntry) {
	firstDifference := ""
	if len(entry.Differences) > 0 {
		firstDifference = entry.Differences[0]
	}

	pushExtractorParityHistory(ExtractorParityHistoryEntry{
		Timestamp:       time.Now().UTC().Format(time.RFC3339),
		RequestKind:     entry.RequestKind,
		Target:          buildExtractorLogRequestTarget(entry.RequestKind, entry.Username, entry.TimelineType, entry.MediaType, entry.StartDate, entry.EndDate),
		GoSupported:     entry.GoSupported,
		SupportReason:   entry.SupportReason,
		PythonSuccess:   entry.PythonError == "",
		GoSuccess:       entry.GoError == "",
		Equal:           entry.Equal,
		DiffCount:       len(entry.Differences),
		FirstDifference: firstDifference,
		PythonSummary:   cloneExtractorResponseSummary(entry.PythonSummary),
		GoSummary:       cloneExtractorResponseSummary(entry.GoSummary),
		PythonError:     entry.PythonError,
		GoError:         entry.GoError,
	})
}

func recordXPublicMediaDiagnosticLogEntry(entry xPublicMediaDiagnosticLogEntry) {
	pushExtractorRecentEvent(ExtractorRecentEvent{
		Timestamp:      time.Now().UTC().Format(time.RFC3339),
		Event:          entry.Event,
		RequestKind:    "timeline",
		RequestFamily:  ExtractorRequestFamilyMedia,
		RequestTarget:  buildExtractorLogRequestTarget("timeline", entry.Username, "media", entry.MediaType, "", ""),
		Username:       entry.Username,
		TimelineType:   "media",
		MediaType:      entry.MediaType,
		Success:        entry.Success,
		FallbackCode:   entry.FallbackCode,
		AuthMode:       entry.AuthMode,
		CursorPresent:  entry.CursorPresent,
		PageItemCount:  entry.PageItemCount,
		MediaItemCount: entry.MediaItemCount,
		PartialParse:   entry.PartialParse,
		Stage:          entry.Stage,
		ElapsedMS:      entry.ElapsedMS,
		Error:          entry.Error,
	})
}

func recordXPublicTimelineDiagnosticLogEntry(entry xPublicTimelineDiagnosticLogEntry) {
	pushExtractorRecentEvent(ExtractorRecentEvent{
		Timestamp:      time.Now().UTC().Format(time.RFC3339),
		Event:          entry.Event,
		RequestKind:    "timeline",
		RequestFamily:  ExtractorRequestFamilyTimeline,
		RequestTarget:  buildExtractorLogRequestTarget("timeline", entry.Username, entry.TimelineType, entry.MediaType, "", ""),
		Username:       entry.Username,
		TimelineType:   entry.TimelineType,
		MediaType:      entry.MediaType,
		Success:        entry.Success,
		FallbackCode:   entry.FallbackCode,
		AuthMode:       entry.AuthMode,
		CursorPresent:  entry.CursorPresent,
		PageItemCount:  entry.PageItemCount,
		MediaItemCount: entry.MediaItemCount,
		MetadataCount:  entry.MetadataCount,
		PartialParse:   entry.PartialParse,
		Stage:          entry.Stage,
		CursorStage:    entry.CursorStage,
		ElapsedMS:      entry.ElapsedMS,
		Error:          entry.Error,
	})
}

func recordXPublicSearchDiagnosticLogEntry(entry xPublicSearchDiagnosticLogEntry) {
	pushExtractorRecentEvent(ExtractorRecentEvent{
		Timestamp:      time.Now().UTC().Format(time.RFC3339),
		Event:          entry.Event,
		RequestKind:    "date_range",
		RequestFamily:  ExtractorRequestFamilyDateRange,
		RequestTarget:  buildExtractorLogRequestTarget("date_range", entry.Username, "date_range", entry.MediaFilter, "", ""),
		Username:       entry.Username,
		TimelineType:   "date_range",
		MediaType:      entry.MediaFilter,
		Success:        entry.Success,
		FallbackCode:   entry.FallbackCode,
		AuthMode:       entry.AuthMode,
		PageCount:      entry.PageCount,
		TweetCount:     entry.TweetCount,
		MediaItemCount: entry.MediaItemCount,
		TextItemCount:  entry.TextItemCount,
		PartialParse:   entry.PartialParse,
		Stage:          entry.Stage,
		ElapsedMS:      entry.ElapsedMS,
		Error:          entry.Error,
	})
}

func recordXPrivateLikesDiagnosticLogEntry(entry xPrivateLikesDiagnosticLogEntry) {
	pushExtractorRecentEvent(ExtractorRecentEvent{
		Timestamp:      time.Now().UTC().Format(time.RFC3339),
		Event:          entry.Event,
		RequestKind:    "timeline",
		RequestTarget:  buildExtractorLogRequestTarget("timeline", firstNonEmpty(entry.Username, "likes"), "likes", entry.MediaType, "", ""),
		Username:       entry.Username,
		TimelineType:   "likes",
		MediaType:      entry.MediaType,
		Success:        entry.Success,
		FallbackCode:   entry.FallbackCode,
		AuthMode:       entry.AuthMode,
		CursorPresent:  entry.CursorPresent,
		PageItemCount:  entry.PageItemCount,
		MediaItemCount: entry.MediaItemCount,
		TextItemCount:  entry.TextItemCount,
		PartialParse:   entry.PartialParse,
		Stage:          entry.Stage,
		ElapsedMS:      entry.ElapsedMS,
		Error:          entry.Error,
	})
}

func recordXPrivateBookmarksDiagnosticLogEntry(entry xPrivateBookmarksDiagnosticLogEntry) {
	pushExtractorRecentEvent(ExtractorRecentEvent{
		Timestamp:      time.Now().UTC().Format(time.RFC3339),
		Event:          entry.Event,
		RequestKind:    "timeline",
		RequestTarget:  buildExtractorLogRequestTarget("timeline", "bookmarks", "bookmarks", entry.MediaType, "", ""),
		TimelineType:   "bookmarks",
		MediaType:      entry.MediaType,
		Success:        entry.Success,
		FallbackCode:   entry.FallbackCode,
		AuthMode:       entry.AuthMode,
		CursorPresent:  entry.CursorPresent,
		PageItemCount:  entry.PageItemCount,
		MediaItemCount: entry.MediaItemCount,
		TextItemCount:  entry.TextItemCount,
		PartialParse:   entry.PartialParse,
		Stage:          entry.Stage,
		ElapsedMS:      entry.ElapsedMS,
		Error:          entry.Error,
	})
}

func buildExtractorLogRequestTarget(requestKind string, username string, timelineType string, mediaType string, startDate string, endDate string) string {
	username = cleanUsername(username)
	timelineType = trimLower(timelineType)
	mediaType = trimLower(mediaType)
	switch requestKind {
	case "date_range":
		switch {
		case username != "" && startDate != "" && endDate != "":
			return "@" + username + " " + startDate + ".." + endDate + " [" + mediaType + "]"
		case username != "":
			return "@" + username + " date-range [" + mediaType + "]"
		default:
			return "date-range [" + mediaType + "]"
		}
	default:
		switch timelineType {
		case "bookmarks":
			return "private bookmarks [" + mediaType + "]"
		case "likes":
			if username != "" {
				return "private likes @" + username + " [" + mediaType + "]"
			}
			return "private likes [" + mediaType + "]"
		default:
			if username != "" {
				return "@" + username + " " + timelineType + " [" + mediaType + "]"
			}
			if timelineType != "" {
				return timelineType + " [" + mediaType + "]"
			}
			if mediaType != "" {
				return "[" + mediaType + "]"
			}
			return ""
		}
	}
}

func cloneExtractorParityHistory(source []ExtractorParityHistoryEntry) []ExtractorParityHistoryEntry {
	if len(source) == 0 {
		return nil
	}
	cloned := make([]ExtractorParityHistoryEntry, len(source))
	for index, entry := range source {
		cloned[index] = entry
		cloned[index].PythonSummary = cloneExtractorResponseSummary(entry.PythonSummary)
		cloned[index].GoSummary = cloneExtractorResponseSummary(entry.GoSummary)
	}
	return cloned
}

func cloneExtractorResponseSummary(summary *ExtractorResponseSummary) *ExtractorResponseSummary {
	if summary == nil {
		return nil
	}
	cloned := *summary
	if len(summary.EntryTypes) > 0 {
		cloned.EntryTypes = make(map[string]int, len(summary.EntryTypes))
		for key, value := range summary.EntryTypes {
			cloned.EntryTypes[key] = value
		}
	}
	return &cloned
}

func pushExtractorRecentEvent(entry ExtractorRecentEvent) {
	extractorDiagnosticsState.mu.Lock()
	defer extractorDiagnosticsState.mu.Unlock()
	extractorDiagnosticsState.recentEvents = append([]ExtractorRecentEvent{entry}, extractorDiagnosticsState.recentEvents...)
	if len(extractorDiagnosticsState.recentEvents) > extractorDiagnosticsHistoryLimit {
		extractorDiagnosticsState.recentEvents = extractorDiagnosticsState.recentEvents[:extractorDiagnosticsHistoryLimit]
	}
}

func pushExtractorParityHistory(entry ExtractorParityHistoryEntry) {
	extractorDiagnosticsState.mu.Lock()
	defer extractorDiagnosticsState.mu.Unlock()
	extractorDiagnosticsState.recentParity = append([]ExtractorParityHistoryEntry{entry}, extractorDiagnosticsState.recentParity...)
	if len(extractorDiagnosticsState.recentParity) > extractorDiagnosticsHistoryLimit {
		extractorDiagnosticsState.recentParity = extractorDiagnosticsState.recentParity[:extractorDiagnosticsHistoryLimit]
	}
}

func trimLower(value string) string {
	return strings.ToLower(strings.TrimSpace(value))
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value != "" {
			return value
		}
	}
	return ""
}

func buildExtractorPythonDeprecatedNotice(mode ExtractorEngineMode, status PythonFallbackStatus) string {
	if mode != ExtractorEngineModePython {
		return ""
	}
	if !status.Available {
		return "python extractor has been retired; the python mode alias now runs the go-only runtime and historical evidence is read-only"
	}
	return "python extractor has been retired; the python mode alias now runs the go-only runtime"
}

func buildExtractorDefaultRouteStates(
	policy ExtractorRolloutPolicy,
	publicPromotionStates ExtractorPublicPromotionStates,
	privatePromotionStates ExtractorPrivatePromotionStates,
	publicValidationGates ExtractorPublicFamilyGates,
	privateValidationGates ExtractorPrivateFamilyGates,
	publicLiveGates ExtractorLiveFamilyGates,
	privateLiveGates ExtractorPrivateFamilyGates,
	soakRelease ExtractorSoakReleaseState,
) (ExtractorDefaultRouteStates, bool) {
	states := ExtractorDefaultRouteStates{
		Media: buildExtractorDefaultRouteState(
			policy.PublicPromotions.Media,
			publicPromotionStates.Media,
			publicValidationGates.Media,
			publicLiveGates.Media,
			soakRelease.Families.Media,
		),
		Timeline: buildExtractorDefaultRouteState(
			policy.PublicPromotions.Timeline,
			publicPromotionStates.Timeline,
			publicValidationGates.Timeline,
			publicLiveGates.Timeline,
			soakRelease.Families.Timeline,
		),
		DateRange: buildExtractorDefaultRouteState(
			policy.PublicPromotions.DateRange,
			publicPromotionStates.DateRange,
			publicValidationGates.DateRange,
			publicLiveGates.DateRange,
			soakRelease.Families.DateRange,
		),
		Likes: buildExtractorDefaultRouteState(
			policy.PrivatePromotions.Likes,
			privatePromotionStates.Likes,
			privateValidationGates.Likes,
			privateLiveGates.Likes,
			soakRelease.Families.Likes,
		),
		Bookmarks: buildExtractorDefaultRouteState(
			policy.PrivatePromotions.Bookmarks,
			privatePromotionStates.Bookmarks,
			privateValidationGates.Bookmarks,
			privateLiveGates.Bookmarks,
			soakRelease.Families.Bookmarks,
		),
	}
	phase7Ready := states.Media.DepythonizationReady &&
		states.Timeline.DepythonizationReady &&
		states.DateRange.DepythonizationReady &&
		states.Likes.DepythonizationReady &&
		states.Bookmarks.DepythonizationReady
	return states, phase7Ready
}

func buildExtractorDefaultRouteState(
	policyState ExtractorPublicPromotionPolicyState,
	promotionState ExtractorPublicPromotionState,
	validationGate ExtractorFamilyGateSummary,
	liveGate ExtractorFamilyGateSummary,
	soakState ExtractorSoakFamilyState,
) ExtractorDefaultRouteState {
	state := ExtractorDefaultRouteState{
		Promoted:          policyState.Promoted,
		BaselineActive:    extractorPublicPromotionBaselineValid(policyState),
		DefaultServedByGo: true,
		LastFailureReason: strings.TrimSpace(soakState.LastFailureReason),
		InactiveReason:    "",
		DepythonizationReady: policyState.Promoted &&
			extractorPublicPromotionBaselineValid(policyState) &&
			!soakState.BlockerOpen &&
			soakState.TotalRequests > 0 &&
			validationGate.Gate != ExtractorValidationGateBlocked &&
			liveGate.Gate != ExtractorValidationGateBlocked,
	}
	if promotionState.Active {
		state.BaselineActive = true
	}
	if state.Promoted && !state.BaselineActive {
		state.InactiveReason = "go-only runtime is active, but the historical promotion baseline is missing or invalid"
	}
	if state.LastFailureReason != "" {
		state.FallbackServedByPython = false
	}
	return state
}

func resetExtractorDiagnosticsForTests() {
	extractorDiagnosticsState.mu.Lock()
	extractorDiagnosticsState.recentEvents = nil
	extractorDiagnosticsState.recentParity = nil
	extractorDiagnosticsState.mu.Unlock()

	atomic.StoreUint64(&extractorMetrics.totalRequests, 0)
	atomic.StoreUint64(&extractorMetrics.pythonModeRequests, 0)
	atomic.StoreUint64(&extractorMetrics.goModeRequests, 0)
	atomic.StoreUint64(&extractorMetrics.autoModeRequests, 0)
	atomic.StoreUint64(&extractorMetrics.pythonEngineSelected, 0)
	atomic.StoreUint64(&extractorMetrics.goEngineSelected, 0)
	atomic.StoreUint64(&extractorMetrics.fallbackCount, 0)
	atomic.StoreUint64(&extractorMetrics.unsupportedCount, 0)
	atomic.StoreUint64(&extractorMetrics.fallbackRequiredCount, 0)
	atomic.StoreUint64(&extractorMetrics.parityComparisons, 0)
	atomic.StoreUint64(&extractorMetrics.parityMismatches, 0)
	atomic.StoreUint64(&extractorMetrics.rolloutTrialRequests, 0)
	atomic.StoreUint64(&extractorMetrics.rolloutTrialPythonBypass, 0)
	atomic.StoreUint64(&extractorMetrics.rolloutTrialGoSelected, 0)
	_ = os.Remove(extractorSoakStatePath())
	SetExtractorAppVersion("")
	resetPythonFallbackStatusForTests()
}
