package backend

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"strings"
)

const (
	extractorLiveValidationReportRetentionLimit       = 20
	extractorLiveValidationReportSupportBundleLimit   = 10
	extractorLiveValidationReportSnapshotSummaryLimit = 10
)

type ExtractorRuntimeValidationStatus string

const (
	ExtractorRuntimeValidationStatusSuccess ExtractorRuntimeValidationStatus = "success"
	ExtractorRuntimeValidationStatusFailed  ExtractorRuntimeValidationStatus = "failed"
	ExtractorRuntimeValidationStatusSkipped ExtractorRuntimeValidationStatus = "skipped"
)

type ExtractorRuntimeValidationSummary struct {
	Status          ExtractorRuntimeValidationStatus `json:"status"`
	ConfiguredMode  ExtractorEngineMode              `json:"configured_mode,omitempty"`
	EffectiveMode   ExtractorEngineMode              `json:"effective_mode,omitempty"`
	SelectedEngine  string                           `json:"selected_engine,omitempty"`
	ModeSource      string                           `json:"mode_source,omitempty"`
	FallbackReason  string                           `json:"fallback_reason,omitempty"`
	FallbackCode    string                           `json:"fallback_code,omitempty"`
	ResponseSummary *ExtractorResponseSummary        `json:"response_summary,omitempty"`
	Cursor          string                           `json:"cursor,omitempty"`
	Completed       bool                             `json:"completed,omitempty"`
	CursorIssue     string                           `json:"cursor_issue,omitempty"`
	Error           string                           `json:"error,omitempty"`
}

type ExtractorLiveValidationCaseReport struct {
	PresetID          string                            `json:"preset_id"`
	PresetLabel       string                            `json:"preset_label"`
	RequestKind       string                            `json:"request_kind"`
	Scope             ExtractorValidationScope          `json:"scope"`
	RequestFamily     ExtractorRequestFamily            `json:"request_family,omitempty"`
	Target            string                            `json:"target"`
	Valid             bool                              `json:"valid"`
	SkippedReason     string                            `json:"skipped_reason,omitempty"`
	Runtime           ExtractorRuntimeValidationSummary `json:"runtime"`
	GoSupported       bool                              `json:"go_supported"`
	SupportReason     string                            `json:"support_reason,omitempty"`
	PythonSuccess     bool                              `json:"python_success"`
	GoSuccess         bool                              `json:"go_success"`
	Equal             bool                              `json:"equal"`
	DiffCount         int                               `json:"diff_count"`
	FirstDifference   string                            `json:"first_difference,omitempty"`
	PythonSummary     *ExtractorResponseSummary         `json:"python_summary,omitempty"`
	GoSummary         *ExtractorResponseSummary         `json:"go_summary,omitempty"`
	PythonError       string                            `json:"python_error,omitempty"`
	GoError           string                            `json:"go_error,omitempty"`
	RuntimeDurationMS int64                             `json:"runtime_duration_ms"`
	ParityDurationMS  int64                             `json:"parity_duration_ms"`
	DurationMS        int64                             `json:"duration_ms"`
}

type ExtractorLiveValidationReportSummary struct {
	ReportID                    string                        `json:"report_id"`
	CreatedAt                   string                        `json:"created_at"`
	ConfigUpdatedAt             string                        `json:"config_updated_at,omitempty"`
	TotalCases                  int                           `json:"total_cases"`
	RuntimePassedCases          int                           `json:"runtime_passed_cases"`
	RuntimeFailedCases          int                           `json:"runtime_failed_cases"`
	RuntimeSkippedCases         int                           `json:"runtime_skipped_cases"`
	ParityFamilyGates           ExtractorPublicFamilyGates    `json:"parity_family_gates"`
	PrivateParityFamilyGates    ExtractorPrivateFamilyGates   `json:"private_parity_family_gates"`
	LiveFamilyGates             ExtractorLiveFamilyGates      `json:"live_family_gates"`
	PrivateLiveFamilyGates      ExtractorPrivateFamilyGates   `json:"private_live_family_gates"`
	PromotionFamilyGates        ExtractorPromotionFamilyGates `json:"promotion_family_gates"`
	PrivatePromotionFamilyGates ExtractorPrivateFamilyGates   `json:"private_promotion_family_gates"`
}

type ExtractorLiveValidationReport struct {
	ReportID                    string                                `json:"report_id"`
	CreatedAt                   string                                `json:"created_at"`
	ConfigUpdatedAt             string                                `json:"config_updated_at,omitempty"`
	AppVersion                  string                                `json:"app_version"`
	EngineMode                  ExtractorEngineMode                   `json:"engine_mode"`
	TotalCases                  int                                   `json:"total_cases"`
	RuntimePassedCases          int                                   `json:"runtime_passed_cases"`
	RuntimeFailedCases          int                                   `json:"runtime_failed_cases"`
	RuntimeSkippedCases         int                                   `json:"runtime_skipped_cases"`
	ParityFamilyGates           ExtractorPublicFamilyGates            `json:"parity_family_gates"`
	PrivateParityFamilyGates    ExtractorPrivateFamilyGates           `json:"private_parity_family_gates"`
	LiveFamilyGates             ExtractorLiveFamilyGates              `json:"live_family_gates"`
	PrivateLiveFamilyGates      ExtractorPrivateFamilyGates           `json:"private_live_family_gates"`
	PromotionFamilyGates        ExtractorPromotionFamilyGates         `json:"promotion_family_gates"`
	PrivatePromotionFamilyGates ExtractorPrivateFamilyGates           `json:"private_promotion_family_gates"`
	Diagnostics                 ExtractorValidationDiagnosticsSummary `json:"diagnostics"`
	Cases                       []ExtractorLiveValidationCaseReport   `json:"cases,omitempty"`
}

var (
	runTimelineLiveCandidateFn  = runTimelineLiveCandidate
	runDateRangeLiveCandidateFn = runDateRangeLiveCandidate
)

func extractorLiveValidationReportsDir() string {
	return ResolveAppDataPath("extractor_live_reports")
}

func RunExtractorLiveValidationSession(
	appVersion string,
	req ExtractorValidationRunRequest,
) (*ExtractorLiveValidationReport, error) {
	config, err := loadExtractorRunbookConfig()
	if err != nil {
		return nil, err
	}

	report := &ExtractorLiveValidationReport{
		ReportID:        fmt.Sprintf("live-%d", extractorRunbookNow().UTC().UnixNano()),
		CreatedAt:       formatExtractorRunbookTimestamp(extractorRunbookNow()),
		ConfigUpdatedAt: strings.TrimSpace(config.UpdatedAt),
		AppVersion:      strings.TrimSpace(appVersion),
		EngineMode:      currentExtractorEngineMode(),
		Diagnostics: ExtractorValidationDiagnosticsSummary{
			CurrentMode:             currentExtractorEngineMode(),
			PrivateAutoPinned:       false,
			PrivateAutoPinnedReason: "",
			SupportMatrix:           buildExtractorSupportMatrixSummary(),
			Metrics:                 GetExtractorMetricsSnapshot(),
		},
	}

	if reason, pinned := timelineAutoBypassReason(TimelineRequest{TimelineType: "likes"}); pinned {
		report.Diagnostics.PrivateAutoPinned = true
		report.Diagnostics.PrivateAutoPinnedReason = reason
	}

	publicToken := strings.TrimSpace(req.PublicAuthToken)
	privateToken := strings.TrimSpace(req.PrivateAuthToken)

	for _, preset := range config.Presets {
		if !preset.Enabled {
			continue
		}
		caseReport := runExtractorLiveValidationPreset(preset, publicToken, privateToken)
		report.Cases = append(report.Cases, caseReport)
	}

	applyExtractorLiveValidationSummary(report)
	if err := saveExtractorLiveValidationReport(report); err != nil {
		return nil, err
	}
	return report, nil
}

func runExtractorLiveValidationPreset(
	preset ExtractorRunbookPreset,
	publicToken string,
	privateToken string,
) ExtractorLiveValidationCaseReport {
	preset = sanitizeExtractorRunbookPreset(preset, false, 0)
	caseReport := ExtractorLiveValidationCaseReport{
		PresetID:    preset.ID,
		PresetLabel: preset.Label,
		RequestKind: preset.RequestKind,
		Scope:       preset.Scope,
		Target:      buildExtractorRunbookPresetTarget(preset),
		Valid:       false,
		Runtime:     ExtractorRuntimeValidationSummary{Status: ExtractorRuntimeValidationStatusSkipped},
		RequestFamily: func() ExtractorRequestFamily {
			if family, ok := extractorValidationFamilyForPreset(preset); ok {
				return family
			}
			return ""
		}(),
	}

	if reason := validateExtractorRunbookPreset(preset); reason != "" {
		caseReport.SkippedReason = reason
		caseReport.Runtime.Error = reason
		return caseReport
	}
	family, ok := extractorValidationFamilyForPreset(preset)
	if !ok {
		caseReport.SkippedReason = "unsupported request family"
		caseReport.Runtime.Error = caseReport.SkippedReason
		return caseReport
	}
	authToken := publicToken
	switch preset.Scope {
	case ExtractorValidationScopePrivate:
		authToken = privateToken
	default:
		authToken = publicToken
	}
	if strings.TrimSpace(authToken) == "" {
		caseReport.SkippedReason = fmt.Sprintf("missing %s auth token", preset.Scope)
		caseReport.Runtime.Error = caseReport.SkippedReason
		return caseReport
	}

	caseReport.Valid = true
	startedAt := extractorRunbookNow()

	switch preset.RequestKind {
	case "date_range":
		req := DateRangeRequest{
			Username:    preset.Username,
			AuthToken:   authToken,
			StartDate:   preset.StartDate,
			EndDate:     preset.EndDate,
			MediaFilter: preset.MediaType,
			Retweets:    preset.Retweets,
		}
		runtimeStartedAt := extractorRunbookNow()
		runtimeResponse, trace, runtimeErr := runDateRangeLiveCandidateFn(req, family)
		caseReport.RuntimeDurationMS = extractorRunbookNow().Sub(runtimeStartedAt).Milliseconds()
		caseReport.Runtime = summarizeRuntimeValidation("date_range", runtimeResponse, trace, runtimeErr)

		parityStartedAt := extractorRunbookNow()
		parityReport, parityErr := compareDateRangeExtractorParityFn(req)
		caseReport.ParityDurationMS = extractorRunbookNow().Sub(parityStartedAt).Milliseconds()
		mergeExtractorLiveParityCaseReport(&caseReport, parityReport, parityErr)
	default:
		req := TimelineRequest{
			Username:     preset.Username,
			AuthToken:    authToken,
			TimelineType: preset.TimelineType,
			MediaType:    preset.MediaType,
			Retweets:     preset.Retweets,
		}
		runtimeStartedAt := extractorRunbookNow()
		runtimeResponse, trace, runtimeErr := runTimelineLiveCandidateFn(req, family)
		caseReport.RuntimeDurationMS = extractorRunbookNow().Sub(runtimeStartedAt).Milliseconds()
		caseReport.Runtime = summarizeRuntimeValidation("timeline", runtimeResponse, trace, runtimeErr)

		parityStartedAt := extractorRunbookNow()
		parityReport, parityErr := compareTimelineExtractorParityFn(req)
		caseReport.ParityDurationMS = extractorRunbookNow().Sub(parityStartedAt).Milliseconds()
		mergeExtractorLiveParityCaseReport(&caseReport, parityReport, parityErr)
	}

	caseReport.DurationMS = extractorRunbookNow().Sub(startedAt).Milliseconds()
	return caseReport
}

func summarizeRuntimeValidation(
	requestKind string,
	response *TwitterResponse,
	trace extractorRuntimeTrace,
	err error,
) ExtractorRuntimeValidationSummary {
	summary := ExtractorRuntimeValidationSummary{
		Status:          ExtractorRuntimeValidationStatusSuccess,
		ConfiguredMode:  trace.ConfiguredMode,
		EffectiveMode:   trace.EffectiveMode,
		SelectedEngine:  strings.TrimSpace(trace.SelectedEngine),
		ModeSource:      strings.TrimSpace(trace.ModeSource),
		FallbackReason:  strings.TrimSpace(trace.FallbackReason),
		FallbackCode:    strings.TrimSpace(trace.FallbackCode),
		ResponseSummary: summarizeTwitterResponse(response),
		Error:           errorString(err),
	}
	if err != nil {
		summary.Status = ExtractorRuntimeValidationStatusFailed
		return summary
	}
	if response == nil {
		summary.Status = ExtractorRuntimeValidationStatusFailed
		summary.Error = "runtime response is nil"
		return summary
	}
	if summary.ResponseSummary != nil {
		summary.Cursor = strings.TrimSpace(summary.ResponseSummary.Cursor)
		summary.Completed = summary.ResponseSummary.Completed
	}
	summary.CursorIssue = validateRuntimeCursorSemantics(requestKind, response)
	return summary
}

func validateRuntimeCursorSemantics(requestKind string, response *TwitterResponse) string {
	if response == nil {
		return ""
	}
	cursor := strings.TrimSpace(response.Cursor)
	switch requestKind {
	case "date_range":
		if cursor != "" {
			return "date-range runtime must not return a resume cursor"
		}
		if !response.Completed {
			return "date-range runtime must complete in a single validation session"
		}
	default:
		if !response.Completed && cursor == "" {
			return "runtime returned incomplete results without a continuation cursor"
		}
	}
	return ""
}

func mergeExtractorLiveParityCaseReport(
	target *ExtractorLiveValidationCaseReport,
	report *ExtractorParityReport,
	err error,
) {
	if target == nil {
		return
	}
	if report != nil {
		target.GoSupported = report.GoSupported
		target.SupportReason = strings.TrimSpace(report.SupportReason)
		target.PythonSuccess = report.PythonSuccess
		target.GoSuccess = report.GoSuccess
		target.Equal = report.Equal
		target.DiffCount = len(report.Differences)
		if len(report.Differences) > 0 {
			target.FirstDifference = strings.TrimSpace(report.Differences[0])
		}
		target.PythonSummary = cloneExtractorResponseSummary(report.PythonSummary)
		target.GoSummary = cloneExtractorResponseSummary(report.GoSummary)
		target.PythonError = strings.TrimSpace(report.PythonError)
		target.GoError = strings.TrimSpace(report.GoError)
	}
	if err != nil {
		if target.PythonError == "" {
			target.PythonError = strings.TrimSpace(err.Error())
		}
	}
}

func classifyExtractorLiveValidationCase(caseReport ExtractorLiveValidationCaseReport) string {
	if !caseReport.Valid {
		return "invalid"
	}
	if caseReport.Runtime.Status == ExtractorRuntimeValidationStatusSkipped {
		return "invalid"
	}
	if caseReport.Runtime.Status != ExtractorRuntimeValidationStatusSuccess {
		return "failed"
	}
	if strings.TrimSpace(caseReport.Runtime.CursorIssue) != "" {
		return "failed"
	}
	switch caseReport.Runtime.ConfiguredMode {
	case ExtractorEngineModeGo:
		if caseReport.Runtime.EffectiveMode != ExtractorEngineModeGo || caseReport.Runtime.SelectedEngine != "go-twitter" {
			return "failed"
		}
	case ExtractorEngineModeAuto:
		if caseReport.Runtime.EffectiveMode != ExtractorEngineModeAuto || caseReport.Runtime.SelectedEngine != "go-twitter" {
			return "failed"
		}
	default:
		if caseReport.Runtime.EffectiveMode != ExtractorEngineModeAuto ||
			caseReport.Runtime.ModeSource != "live_validation" ||
			caseReport.Runtime.SelectedEngine != "go-twitter" {
			return "failed"
		}
	}
	if caseReport.Runtime.FallbackCode != "" || caseReport.Runtime.FallbackReason != "" {
		return "failed"
	}
	return "passed"
}

func evaluateExtractorLiveFamilyGate(
	cases []ExtractorLiveValidationCaseReport,
	family ExtractorRequestFamily,
) ExtractorFamilyGateSummary {
	summary := defaultExtractorFamilyGateSummary()
	for _, caseReport := range cases {
		caseFamily, ok := extractorValidationFamilyForLiveCase(caseReport)
		if !ok || caseFamily != family {
			continue
		}
		summary.EnabledCases++
		switch classifyExtractorLiveValidationCase(caseReport) {
		case "passed":
			summary.PassedCases++
		case "failed":
			summary.FailedCases++
		default:
			summary.InvalidCases++
		}
	}
	switch {
	case summary.EnabledCases == 0:
		summary.Gate = ExtractorValidationGateIncomplete
	case summary.FailedCases > 0 || summary.MismatchCases > 0:
		summary.Gate = ExtractorValidationGateBlocked
	case summary.InvalidCases > 0:
		summary.Gate = ExtractorValidationGateIncomplete
	default:
		summary.Gate = ExtractorValidationGateReady
	}
	return summary
}

func extractorValidationFamilyForLiveCase(caseReport ExtractorLiveValidationCaseReport) (ExtractorRequestFamily, bool) {
	switch caseReport.RequestFamily {
	case ExtractorRequestFamilyMedia, ExtractorRequestFamilyTimeline, ExtractorRequestFamilyDateRange,
		ExtractorRequestFamilyLikes, ExtractorRequestFamilyBookmarks:
		return caseReport.RequestFamily, true
	default:
		return "", false
	}
}

func evaluateExtractorLiveFamilyGates(cases []ExtractorLiveValidationCaseReport) ExtractorLiveFamilyGates {
	return ExtractorLiveFamilyGates{
		Media:     evaluateExtractorLiveFamilyGate(cases, ExtractorRequestFamilyMedia),
		Timeline:  evaluateExtractorLiveFamilyGate(cases, ExtractorRequestFamilyTimeline),
		DateRange: evaluateExtractorLiveFamilyGate(cases, ExtractorRequestFamilyDateRange),
	}
}

func evaluateExtractorPrivateLiveFamilyGates(cases []ExtractorLiveValidationCaseReport) ExtractorPrivateFamilyGates {
	return ExtractorPrivateFamilyGates{
		Likes:     evaluateExtractorLiveFamilyGate(cases, ExtractorRequestFamilyLikes),
		Bookmarks: evaluateExtractorLiveFamilyGate(cases, ExtractorRequestFamilyBookmarks),
	}
}

func evaluateExtractorPromotionFamilyGate(
	parity ExtractorFamilyGateSummary,
	live ExtractorFamilyGateSummary,
) ExtractorFamilyGateSummary {
	summary := defaultExtractorFamilyGateSummary()
	summary.EnabledCases = max(parity.EnabledCases, live.EnabledCases)
	summary.PassedCases = min(parity.PassedCases, live.PassedCases)
	summary.MismatchCases = parity.MismatchCases
	summary.FailedCases = parity.FailedCases + live.FailedCases + live.MismatchCases
	summary.InvalidCases = parity.InvalidCases + live.InvalidCases
	switch {
	case parity.Gate == ExtractorValidationGateBlocked || live.Gate == ExtractorValidationGateBlocked:
		summary.Gate = ExtractorValidationGateBlocked
	case parity.Gate == ExtractorValidationGateReady && live.Gate == ExtractorValidationGateReady:
		summary.Gate = ExtractorValidationGateReady
		if summary.PassedCases == 0 {
			summary.PassedCases = summary.EnabledCases
		}
	default:
		summary.Gate = ExtractorValidationGateIncomplete
	}
	return summary
}

func evaluateExtractorPromotionFamilyGates(
	parity ExtractorPublicFamilyGates,
	live ExtractorLiveFamilyGates,
) ExtractorPromotionFamilyGates {
	return ExtractorPromotionFamilyGates{
		Media:     evaluateExtractorPromotionFamilyGate(parity.Media, live.Media),
		Timeline:  evaluateExtractorPromotionFamilyGate(parity.Timeline, live.Timeline),
		DateRange: evaluateExtractorPromotionFamilyGate(parity.DateRange, live.DateRange),
	}
}

func evaluateExtractorPrivatePromotionFamilyGates(
	parity ExtractorPrivateFamilyGates,
	live ExtractorPrivateFamilyGates,
) ExtractorPrivateFamilyGates {
	return ExtractorPrivateFamilyGates{
		Likes:     evaluateExtractorPromotionFamilyGate(parity.Likes, live.Likes),
		Bookmarks: evaluateExtractorPromotionFamilyGate(parity.Bookmarks, live.Bookmarks),
	}
}

func applyExtractorLiveValidationSummary(report *ExtractorLiveValidationReport) {
	if report == nil {
		return
	}
	report.TotalCases = len(report.Cases)
	report.RuntimePassedCases = 0
	report.RuntimeFailedCases = 0
	report.RuntimeSkippedCases = 0
	for _, caseReport := range report.Cases {
		switch classifyExtractorLiveValidationCase(caseReport) {
		case "passed":
			report.RuntimePassedCases++
		case "failed":
			report.RuntimeFailedCases++
		default:
			report.RuntimeSkippedCases++
		}
	}
	report.ParityFamilyGates = evaluateExtractorPublicFamilyGates(convertLiveCasesToValidationCases(report.Cases))
	report.PrivateParityFamilyGates = evaluateExtractorPrivateFamilyGates(convertLiveCasesToValidationCases(report.Cases))
	report.LiveFamilyGates = evaluateExtractorLiveFamilyGates(report.Cases)
	report.PrivateLiveFamilyGates = evaluateExtractorPrivateLiveFamilyGates(report.Cases)
	report.PromotionFamilyGates = evaluateExtractorPromotionFamilyGates(report.ParityFamilyGates, report.LiveFamilyGates)
	report.PrivatePromotionFamilyGates = evaluateExtractorPrivatePromotionFamilyGates(report.PrivateParityFamilyGates, report.PrivateLiveFamilyGates)
}

func convertLiveCasesToValidationCases(cases []ExtractorLiveValidationCaseReport) []ExtractorValidationCaseReport {
	converted := make([]ExtractorValidationCaseReport, 0, len(cases))
	for _, caseReport := range cases {
		converted = append(converted, ExtractorValidationCaseReport{
			PresetID:        caseReport.PresetID,
			PresetLabel:     caseReport.PresetLabel,
			RequestKind:     caseReport.RequestKind,
			Scope:           caseReport.Scope,
			RequestFamily:   caseReport.RequestFamily,
			Target:          caseReport.Target,
			Valid:           caseReport.Valid,
			SkippedReason:   caseReport.SkippedReason,
			GoSupported:     caseReport.GoSupported,
			SupportReason:   caseReport.SupportReason,
			PythonSuccess:   caseReport.PythonSuccess,
			GoSuccess:       caseReport.GoSuccess,
			Equal:           caseReport.Equal,
			DiffCount:       caseReport.DiffCount,
			FirstDifference: caseReport.FirstDifference,
			PythonSummary:   cloneExtractorResponseSummary(caseReport.PythonSummary),
			GoSummary:       cloneExtractorResponseSummary(caseReport.GoSummary),
			PythonError:     caseReport.PythonError,
			GoError:         caseReport.GoError,
			DurationMS:      caseReport.ParityDurationMS,
		})
	}
	return converted
}

func saveExtractorLiveValidationReport(report *ExtractorLiveValidationReport) error {
	if report == nil {
		return fmt.Errorf("live validation report is required")
	}
	if err := os.MkdirAll(extractorLiveValidationReportsDir(), 0o700); err != nil {
		return err
	}
	filename := fmt.Sprintf("%s-%s.json", extractorRunbookNow().UTC().Format("20060102-150405"), sanitizeExtractorRunbookFilename(report.ReportID))
	path := filepath.Join(extractorLiveValidationReportsDir(), filename)
	data, err := json.MarshalIndent(report, "", "  ")
	if err != nil {
		return err
	}
	data = append(data, '\n')
	if err := os.WriteFile(path, data, 0o600); err != nil {
		return err
	}
	return trimExtractorLiveValidationReports(extractorLiveValidationReportRetentionLimit)
}

func trimExtractorLiveValidationReports(limit int) error {
	paths, err := listExtractorLiveValidationReportPaths()
	if err != nil {
		return err
	}
	for index, path := range paths {
		if index < limit {
			continue
		}
		if err := os.Remove(path); err != nil && !os.IsNotExist(err) {
			return err
		}
	}
	return nil
}

func listExtractorLiveValidationReportPaths() ([]string, error) {
	matches, err := filepath.Glob(filepath.Join(extractorLiveValidationReportsDir(), "*.json"))
	if err != nil {
		return nil, err
	}
	paths := make([]string, 0, len(matches))
	for _, match := range matches {
		info, err := os.Stat(match)
		if err != nil {
			if os.IsNotExist(err) {
				continue
			}
			return nil, err
		}
		if info.Mode().IsRegular() {
			paths = append(paths, match)
		}
	}
	slices.SortFunc(paths, func(left, right string) int {
		leftInfo, leftErr := os.Stat(left)
		rightInfo, rightErr := os.Stat(right)
		if leftErr == nil && rightErr == nil {
			if leftInfo.ModTime().After(rightInfo.ModTime()) {
				return -1
			}
			if leftInfo.ModTime().Before(rightInfo.ModTime()) {
				return 1
			}
		}
		return strings.Compare(filepath.Base(right), filepath.Base(left))
	})
	return paths, nil
}

func loadExtractorLiveValidationReport(path string) (*ExtractorLiveValidationReport, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var report ExtractorLiveValidationReport
	if err := json.Unmarshal(raw, &report); err != nil {
		return nil, err
	}
	return &report, nil
}

func summarizeExtractorLiveValidationReport(report *ExtractorLiveValidationReport) ExtractorLiveValidationReportSummary {
	if report == nil {
		return ExtractorLiveValidationReportSummary{
			ParityFamilyGates:           defaultExtractorPublicFamilyGates(),
			PrivateParityFamilyGates:    defaultExtractorPrivateFamilyGates(),
			LiveFamilyGates:             defaultExtractorLiveFamilyGates(),
			PrivateLiveFamilyGates:      defaultExtractorPrivateFamilyGates(),
			PromotionFamilyGates:        defaultExtractorPromotionFamilyGates(),
			PrivatePromotionFamilyGates: defaultExtractorPrivateFamilyGates(),
		}
	}
	return ExtractorLiveValidationReportSummary{
		ReportID:                    strings.TrimSpace(report.ReportID),
		CreatedAt:                   strings.TrimSpace(report.CreatedAt),
		ConfigUpdatedAt:             strings.TrimSpace(report.ConfigUpdatedAt),
		TotalCases:                  report.TotalCases,
		RuntimePassedCases:          report.RuntimePassedCases,
		RuntimeFailedCases:          report.RuntimeFailedCases,
		RuntimeSkippedCases:         report.RuntimeSkippedCases,
		ParityFamilyGates:           report.ParityFamilyGates,
		PrivateParityFamilyGates:    report.PrivateParityFamilyGates,
		LiveFamilyGates:             report.LiveFamilyGates,
		PrivateLiveFamilyGates:      report.PrivateLiveFamilyGates,
		PromotionFamilyGates:        report.PromotionFamilyGates,
		PrivatePromotionFamilyGates: report.PrivatePromotionFamilyGates,
	}
}

func loadExtractorLiveValidationReportSummaries(limit int) ([]ExtractorLiveValidationReportSummary, error) {
	paths, err := listExtractorLiveValidationReportPaths()
	if err != nil {
		return nil, err
	}
	if limit > 0 && len(paths) > limit {
		paths = paths[:limit]
	}
	summaries := make([]ExtractorLiveValidationReportSummary, 0, len(paths))
	for _, path := range paths {
		report, err := loadExtractorLiveValidationReport(path)
		if err != nil {
			continue
		}
		summaries = append(summaries, summarizeExtractorLiveValidationReport(report))
	}
	if summaries == nil {
		summaries = []ExtractorLiveValidationReportSummary{}
	}
	return summaries, nil
}

func resolveExtractorLiveValidationGates(
	config ExtractorRunbookConfig,
	summaries []ExtractorLiveValidationReportSummary,
) (ExtractorLiveFamilyGates, ExtractorPromotionFamilyGates, ExtractorPrivateFamilyGates, ExtractorPrivateFamilyGates) {
	familyEnabled := defaultExtractorPublicFamilyGates()
	privateFamilyEnabled := defaultExtractorPrivateFamilyGates()
	for _, preset := range config.Presets {
		if !preset.Enabled {
			continue
		}
		if family, ok := extractorValidationFamilyForPreset(preset); ok {
			if extractorFamilyIsPrivate(family) {
				summary := extractorPrivateFamilyGateByName(privateFamilyEnabled, family)
				summary.EnabledCases++
				assignExtractorPrivateFamilyGateSummary(&privateFamilyEnabled, family, summary)
			} else {
				summary := extractorFamilyGateByName(familyEnabled, family)
				summary.EnabledCases++
				assignExtractorFamilyGateSummary(&familyEnabled, family, summary)
			}
		}
	}

	liveFamilyGates := defaultExtractorLiveFamilyGates()
	promotionFamilyGates := defaultExtractorPromotionFamilyGates()
	privateLiveFamilyGates := defaultExtractorPrivateFamilyGates()
	privatePromotionFamilyGates := defaultExtractorPrivateFamilyGates()
	configUpdatedAt := strings.TrimSpace(config.UpdatedAt)
	for _, summary := range summaries {
		if configUpdatedAt == "" || strings.TrimSpace(summary.ConfigUpdatedAt) != configUpdatedAt {
			continue
		}
		liveFamilyGates = summary.LiveFamilyGates
		promotionFamilyGates = summary.PromotionFamilyGates
		privateLiveFamilyGates = summary.PrivateLiveFamilyGates
		privatePromotionFamilyGates = summary.PrivatePromotionFamilyGates
		break
	}

	assignMissingLiveFamilyGate(&liveFamilyGates.Media, familyEnabled.Media.EnabledCases)
	assignMissingLiveFamilyGate(&liveFamilyGates.Timeline, familyEnabled.Timeline.EnabledCases)
	assignMissingLiveFamilyGate(&liveFamilyGates.DateRange, familyEnabled.DateRange.EnabledCases)
	assignMissingLiveFamilyGate(&promotionFamilyGates.Media, familyEnabled.Media.EnabledCases)
	assignMissingLiveFamilyGate(&promotionFamilyGates.Timeline, familyEnabled.Timeline.EnabledCases)
	assignMissingLiveFamilyGate(&promotionFamilyGates.DateRange, familyEnabled.DateRange.EnabledCases)
	assignMissingLiveFamilyGate(&privateLiveFamilyGates.Likes, privateFamilyEnabled.Likes.EnabledCases)
	assignMissingLiveFamilyGate(&privateLiveFamilyGates.Bookmarks, privateFamilyEnabled.Bookmarks.EnabledCases)
	assignMissingLiveFamilyGate(&privatePromotionFamilyGates.Likes, privateFamilyEnabled.Likes.EnabledCases)
	assignMissingLiveFamilyGate(&privatePromotionFamilyGates.Bookmarks, privateFamilyEnabled.Bookmarks.EnabledCases)

	return liveFamilyGates, promotionFamilyGates, privateLiveFamilyGates, privatePromotionFamilyGates
}

func assignMissingLiveFamilyGate(summary *ExtractorFamilyGateSummary, enabledCases int) {
	if summary == nil {
		return
	}
	if enabledCases == 0 {
		*summary = defaultExtractorFamilyGateSummary()
		return
	}
	if summary.EnabledCases == 0 {
		summary.EnabledCases = enabledCases
		summary.Gate = ExtractorValidationGateIncomplete
	}
}

func collectExtractorLiveValidationReportFiles(limit int) ([]string, error) {
	paths, err := listExtractorLiveValidationReportPaths()
	if err != nil {
		return nil, err
	}
	if limit > 0 && len(paths) > limit {
		paths = paths[:limit]
	}
	return paths, nil
}

func runTimelineLiveCandidate(
	req TimelineRequest,
	family ExtractorRequestFamily,
) (*TwitterResponse, extractorRuntimeTrace, error) {
	return extractTimelineWithEngineOverride(
		context.Background(),
		req,
		currentExtractorEngineMode(),
		newGoTwitterEngine(),
		newGoTwitterEngine(),
		&extractorExecutionOverride{CandidateFamily: family},
	)
}

func runDateRangeLiveCandidate(
	req DateRangeRequest,
	family ExtractorRequestFamily,
) (*TwitterResponse, extractorRuntimeTrace, error) {
	return extractDateRangeWithEngineOverride(
		context.Background(),
		req,
		currentExtractorEngineMode(),
		newGoTwitterEngine(),
		newGoTwitterEngine(),
		&extractorExecutionOverride{CandidateFamily: family},
	)
}
