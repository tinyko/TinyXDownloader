package backend

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"time"
)

const (
	extractorValidationReportRetentionLimit       = 20
	extractorValidationReportSupportBundleLimit   = 10
	extractorValidationReportSnapshotSummaryLimit = 10
)

type ExtractorValidationScope string

const (
	ExtractorValidationScopePublic  ExtractorValidationScope = "public"
	ExtractorValidationScopePrivate ExtractorValidationScope = "private"
)

type ExtractorValidationGate string

const (
	ExtractorValidationGateReady      ExtractorValidationGate = "ready"
	ExtractorValidationGateBlocked    ExtractorValidationGate = "blocked"
	ExtractorValidationGateIncomplete ExtractorValidationGate = "incomplete"
)

type ExtractorRunbookPreset struct {
	ID           string                   `json:"id"`
	Label        string                   `json:"label"`
	Enabled      bool                     `json:"enabled"`
	RequestKind  string                   `json:"request_kind"`
	Scope        ExtractorValidationScope `json:"scope"`
	Username     string                   `json:"username,omitempty"`
	TimelineType string                   `json:"timeline_type,omitempty"`
	MediaType    string                   `json:"media_type,omitempty"`
	Retweets     bool                     `json:"retweets,omitempty"`
	StartDate    string                   `json:"start_date,omitempty"`
	EndDate      string                   `json:"end_date,omitempty"`
}

type ExtractorRunbookConfig struct {
	UpdatedAt string                   `json:"updated_at,omitempty"`
	Presets   []ExtractorRunbookPreset `json:"presets"`
}

type ExtractorValidationRunRequest struct {
	PublicAuthToken  string `json:"public_auth_token,omitempty"`
	PrivateAuthToken string `json:"private_auth_token,omitempty"`
}

type ExtractorValidationDiagnosticsSummary struct {
	CurrentMode             ExtractorEngineMode           `json:"current_mode"`
	PrivateAutoPinned       bool                          `json:"private_auto_pinned"`
	PrivateAutoPinnedReason string                        `json:"private_auto_pinned_reason,omitempty"`
	SupportMatrix           ExtractorSupportMatrixSummary `json:"support_matrix"`
	Metrics                 ExtractorMetricsSnapshot      `json:"metrics"`
}

type ExtractorValidationCaseReport struct {
	PresetID        string                    `json:"preset_id"`
	PresetLabel     string                    `json:"preset_label"`
	RequestKind     string                    `json:"request_kind"`
	Scope           ExtractorValidationScope  `json:"scope"`
	RequestFamily   ExtractorRequestFamily    `json:"request_family,omitempty"`
	Target          string                    `json:"target"`
	Valid           bool                      `json:"valid"`
	SkippedReason   string                    `json:"skipped_reason,omitempty"`
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
	DurationMS      int64                     `json:"duration_ms"`
}

type ExtractorValidationReportSummary struct {
	ReportID          string                     `json:"report_id"`
	CreatedAt         string                     `json:"created_at"`
	ConfigUpdatedAt   string                     `json:"config_updated_at,omitempty"`
	TotalCases        int                        `json:"total_cases"`
	PassedCases       int                        `json:"passed_cases"`
	MismatchCases     int                        `json:"mismatch_cases"`
	FailedCases       int                        `json:"failed_cases"`
	InvalidCases      int                        `json:"invalid_cases"`
	PublicGate        ExtractorValidationGate    `json:"public_gate"`
	PrivateGate       ExtractorValidationGate    `json:"private_gate"`
	PublicFamilyGates ExtractorPublicFamilyGates `json:"public_family_gates"`
}

type ExtractorValidationReport struct {
	ReportID          string                                `json:"report_id"`
	CreatedAt         string                                `json:"created_at"`
	ConfigUpdatedAt   string                                `json:"config_updated_at,omitempty"`
	AppVersion        string                                `json:"app_version"`
	EngineMode        ExtractorEngineMode                   `json:"engine_mode"`
	TotalCases        int                                   `json:"total_cases"`
	PassedCases       int                                   `json:"passed_cases"`
	MismatchCases     int                                   `json:"mismatch_cases"`
	FailedCases       int                                   `json:"failed_cases"`
	InvalidCases      int                                   `json:"invalid_cases"`
	PublicGate        ExtractorValidationGate               `json:"public_gate"`
	PrivateGate       ExtractorValidationGate               `json:"private_gate"`
	PublicFamilyGates ExtractorPublicFamilyGates            `json:"public_family_gates"`
	Diagnostics       ExtractorValidationDiagnosticsSummary `json:"diagnostics"`
	Cases             []ExtractorValidationCaseReport       `json:"cases,omitempty"`
}

var (
	extractorRunbookNow               = time.Now
	compareTimelineExtractorParityFn  = CompareTimelineExtractorParity
	compareDateRangeExtractorParityFn = CompareDateRangeExtractorParity
)

func formatExtractorRunbookTimestamp(value time.Time) string {
	return value.UTC().Format(time.RFC3339Nano)
}

func extractorRunbookConfigPath() string {
	return ResolveAppDataPath("extractor_runbook.json")
}

func extractorValidationReportsDir() string {
	return ResolveAppDataPath("extractor_reports")
}

func loadExtractorRunbookConfig() (ExtractorRunbookConfig, error) {
	config := ExtractorRunbookConfig{
		Presets: []ExtractorRunbookPreset{},
	}
	raw, err := os.ReadFile(extractorRunbookConfigPath())
	if err != nil {
		if os.IsNotExist(err) {
			return config, nil
		}
		return config, err
	}
	if err := json.Unmarshal(raw, &config); err != nil {
		return ExtractorRunbookConfig{}, err
	}
	config = sanitizeExtractorRunbookConfig(config, false)
	if config.Presets == nil {
		config.Presets = []ExtractorRunbookPreset{}
	}
	return config, nil
}

func SaveExtractorRunbookConfig(config ExtractorRunbookConfig) (ExtractorRunbookConfig, error) {
	if err := EnsureAppDataDir(); err != nil {
		return ExtractorRunbookConfig{}, err
	}
	config = sanitizeExtractorRunbookConfig(config, true)
	if config.Presets == nil {
		config.Presets = []ExtractorRunbookPreset{}
	}
	config.UpdatedAt = formatExtractorRunbookTimestamp(extractorRunbookNow())

	data, err := json.MarshalIndent(config, "", "  ")
	if err != nil {
		return ExtractorRunbookConfig{}, err
	}
	data = append(data, '\n')
	if err := os.WriteFile(extractorRunbookConfigPath(), data, 0o600); err != nil {
		return ExtractorRunbookConfig{}, err
	}
	return config, nil
}

func RunExtractorValidationRunbook(appVersion string, req ExtractorValidationRunRequest) (*ExtractorValidationReport, error) {
	config, err := loadExtractorRunbookConfig()
	if err != nil {
		return nil, err
	}

	report := &ExtractorValidationReport{
		ReportID:        fmt.Sprintf("runbook-%d", extractorRunbookNow().UTC().UnixNano()),
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
		caseReport := runExtractorValidationPreset(preset, publicToken, privateToken)
		report.Cases = append(report.Cases, caseReport)
	}

	applyExtractorValidationSummary(report)
	if err := saveExtractorValidationReport(report); err != nil {
		return nil, err
	}
	return report, nil
}

func sanitizeExtractorRunbookConfig(config ExtractorRunbookConfig, assignIDs bool) ExtractorRunbookConfig {
	config.UpdatedAt = strings.TrimSpace(config.UpdatedAt)
	presets := make([]ExtractorRunbookPreset, 0, len(config.Presets))
	for index, preset := range config.Presets {
		sanitized := sanitizeExtractorRunbookPreset(preset, assignIDs, index)
		if strings.TrimSpace(sanitized.ID) == "" {
			continue
		}
		presets = append(presets, sanitized)
	}
	config.Presets = presets
	return config
}

func sanitizeExtractorRunbookPreset(preset ExtractorRunbookPreset, assignID bool, index int) ExtractorRunbookPreset {
	preset.ID = strings.TrimSpace(preset.ID)
	if preset.ID == "" && assignID {
		preset.ID = fmt.Sprintf("preset-%d-%d", extractorRunbookNow().UTC().UnixNano(), index)
	}
	preset.RequestKind = trimLower(preset.RequestKind)
	preset.Scope = ExtractorValidationScope(trimLower(string(preset.Scope)))
	preset.Username = cleanUsername(preset.Username)
	preset.TimelineType = trimLower(preset.TimelineType)
	preset.MediaType = trimLower(preset.MediaType)
	preset.StartDate = strings.TrimSpace(preset.StartDate)
	preset.EndDate = strings.TrimSpace(preset.EndDate)
	preset.Label = strings.TrimSpace(preset.Label)
	if preset.Label == "" {
		preset.Label = buildExtractorRunbookPresetTarget(preset)
	}
	return preset
}

func runExtractorValidationPreset(
	preset ExtractorRunbookPreset,
	publicToken string,
	privateToken string,
) ExtractorValidationCaseReport {
	preset = sanitizeExtractorRunbookPreset(preset, false, 0)
	caseReport := ExtractorValidationCaseReport{
		PresetID:    preset.ID,
		PresetLabel: preset.Label,
		RequestKind: preset.RequestKind,
		Scope:       preset.Scope,
		RequestFamily: func() ExtractorRequestFamily {
			if family, ok := extractorValidationFamilyForPreset(preset); ok {
				return family
			}
			return ""
		}(),
		Target: buildExtractorRunbookPresetTarget(preset),
		Valid:  false,
	}

	if reason := validateExtractorRunbookPreset(preset); reason != "" {
		caseReport.SkippedReason = reason
		return caseReport
	}

	authToken := publicToken
	if preset.Scope == ExtractorValidationScopePrivate {
		authToken = privateToken
	}
	if strings.TrimSpace(authToken) == "" {
		caseReport.SkippedReason = fmt.Sprintf("missing %s auth token", preset.Scope)
		return caseReport
	}

	caseReport.Valid = true
	startedAt := extractorRunbookNow()

	switch preset.RequestKind {
	case "date_range":
		report, err := compareDateRangeExtractorParityFn(DateRangeRequest{
			Username:    preset.Username,
			AuthToken:   authToken,
			StartDate:   preset.StartDate,
			EndDate:     preset.EndDate,
			MediaFilter: preset.MediaType,
			Retweets:    preset.Retweets,
		})
		caseReport.DurationMS = time.Since(startedAt).Milliseconds()
		mergeExtractorValidationCaseReport(&caseReport, report, err)
	default:
		report, err := compareTimelineExtractorParityFn(TimelineRequest{
			Username:     preset.Username,
			AuthToken:    authToken,
			TimelineType: preset.TimelineType,
			BatchSize:    0,
			Page:         0,
			MediaType:    preset.MediaType,
			Retweets:     preset.Retweets,
		})
		caseReport.DurationMS = time.Since(startedAt).Milliseconds()
		mergeExtractorValidationCaseReport(&caseReport, report, err)
	}

	return caseReport
}

func mergeExtractorValidationCaseReport(
	target *ExtractorValidationCaseReport,
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
			target.FirstDifference = report.Differences[0]
		}
		target.PythonSummary = cloneExtractorResponseSummary(report.PythonSummary)
		target.GoSummary = cloneExtractorResponseSummary(report.GoSummary)
		target.PythonError = strings.TrimSpace(report.PythonError)
		target.GoError = strings.TrimSpace(report.GoError)
	}
	if err != nil && target.GoError == "" && target.PythonError == "" {
		target.GoError = strings.TrimSpace(err.Error())
	}
}

func validateExtractorRunbookPreset(preset ExtractorRunbookPreset) string {
	switch preset.Scope {
	case ExtractorValidationScopePublic, ExtractorValidationScopePrivate:
	default:
		return "invalid scope"
	}
	switch preset.RequestKind {
	case "timeline":
		if preset.Scope == ExtractorValidationScopePublic {
			switch preset.TimelineType {
			case "media", "timeline", "tweets", "with_replies":
			default:
				return "invalid public timeline type"
			}
		} else {
			switch preset.TimelineType {
			case "likes":
				if preset.Username == "" {
					return "private likes preset requires a username"
				}
			case "bookmarks":
			default:
				return "invalid private timeline type"
			}
		}
		if !slices.Contains([]string{"all", "image", "video", "gif", "text"}, preset.MediaType) {
			return "invalid media type"
		}
		if preset.TimelineType != "bookmarks" && preset.Username == "" {
			return "username is required"
		}
	case "date_range":
		if preset.Scope != ExtractorValidationScopePublic {
			return "date-range presets must be public"
		}
		if preset.Username == "" {
			return "username is required"
		}
		if preset.StartDate == "" || preset.EndDate == "" {
			return "date-range preset requires start and end dates"
		}
		if !slices.Contains([]string{"all", "image", "video", "gif", "text"}, preset.MediaType) {
			return "invalid media filter"
		}
	default:
		return "invalid request kind"
	}
	return ""
}

func buildExtractorRunbookPresetTarget(preset ExtractorRunbookPreset) string {
	switch preset.RequestKind {
	case "date_range":
		return buildExtractorLogRequestTarget("date_range", preset.Username, "date_range", preset.MediaType, preset.StartDate, preset.EndDate)
	default:
		return buildExtractorLogRequestTarget("timeline", preset.Username, preset.TimelineType, preset.MediaType, "", "")
	}
}

func applyExtractorValidationSummary(report *ExtractorValidationReport) {
	if report == nil {
		return
	}
	report.TotalCases = len(report.Cases)
	report.PassedCases = 0
	report.MismatchCases = 0
	report.FailedCases = 0
	report.InvalidCases = 0

	for _, caseReport := range report.Cases {
		switch classifyExtractorValidationCase(caseReport) {
		case "passed":
			report.PassedCases++
		case "mismatch":
			report.MismatchCases++
		case "failed":
			report.FailedCases++
		default:
			report.InvalidCases++
		}
	}

	report.PublicGate = evaluateExtractorValidationGate(report.Cases, ExtractorValidationScopePublic)
	report.PrivateGate = evaluateExtractorValidationGate(report.Cases, ExtractorValidationScopePrivate)
	report.PublicFamilyGates = evaluateExtractorPublicFamilyGates(report.Cases)
}

func classifyExtractorValidationCase(caseReport ExtractorValidationCaseReport) string {
	if !caseReport.Valid {
		return "invalid"
	}
	if !caseReport.GoSupported || !caseReport.PythonSuccess || !caseReport.GoSuccess {
		return "failed"
	}
	if !caseReport.Equal || caseReport.DiffCount > 0 {
		return "mismatch"
	}
	return "passed"
}

func evaluateExtractorValidationGate(cases []ExtractorValidationCaseReport, scope ExtractorValidationScope) ExtractorValidationGate {
	relevantCount := 0
	hasInvalid := false
	hasBlocked := false
	for _, caseReport := range cases {
		if caseReport.Scope != scope {
			continue
		}
		relevantCount++
		if !caseReport.Valid {
			hasInvalid = true
			continue
		}
		if !caseReport.GoSupported || !caseReport.PythonSuccess || !caseReport.GoSuccess || !caseReport.Equal || caseReport.DiffCount > 0 {
			hasBlocked = true
		}
	}
	switch {
	case relevantCount == 0:
		return ExtractorValidationGateIncomplete
	case hasBlocked:
		return ExtractorValidationGateBlocked
	case hasInvalid:
		return ExtractorValidationGateIncomplete
	default:
		return ExtractorValidationGateReady
	}
}

func evaluateExtractorFamilyGate(cases []ExtractorValidationCaseReport, family ExtractorRequestFamily) ExtractorFamilyGateSummary {
	summary := defaultExtractorFamilyGateSummary()
	for _, caseReport := range cases {
		caseFamily, ok := extractorValidationFamilyForCase(caseReport)
		if !ok || caseFamily != family {
			continue
		}
		summary.EnabledCases++
		switch classifyExtractorValidationCase(caseReport) {
		case "passed":
			summary.PassedCases++
		case "mismatch":
			summary.MismatchCases++
		case "failed":
			summary.FailedCases++
		default:
			summary.InvalidCases++
		}
	}
	switch {
	case summary.EnabledCases == 0:
		summary.Gate = ExtractorValidationGateIncomplete
	case summary.MismatchCases > 0 || summary.FailedCases > 0:
		summary.Gate = ExtractorValidationGateBlocked
	case summary.InvalidCases > 0:
		summary.Gate = ExtractorValidationGateIncomplete
	default:
		summary.Gate = ExtractorValidationGateReady
	}
	return summary
}

func evaluateExtractorPublicFamilyGates(cases []ExtractorValidationCaseReport) ExtractorPublicFamilyGates {
	return ExtractorPublicFamilyGates{
		Media:     evaluateExtractorFamilyGate(cases, ExtractorRequestFamilyMedia),
		Timeline:  evaluateExtractorFamilyGate(cases, ExtractorRequestFamilyTimeline),
		DateRange: evaluateExtractorFamilyGate(cases, ExtractorRequestFamilyDateRange),
	}
}

func saveExtractorValidationReport(report *ExtractorValidationReport) error {
	if report == nil {
		return fmt.Errorf("validation report is required")
	}
	if err := os.MkdirAll(extractorValidationReportsDir(), 0o700); err != nil {
		return err
	}
	filename := fmt.Sprintf("%s-%s.json", extractorRunbookNow().UTC().Format("20060102-150405"), sanitizeExtractorRunbookFilename(report.ReportID))
	path := filepath.Join(extractorValidationReportsDir(), filename)
	data, err := json.MarshalIndent(report, "", "  ")
	if err != nil {
		return err
	}
	data = append(data, '\n')
	if err := os.WriteFile(path, data, 0o600); err != nil {
		return err
	}
	return trimExtractorValidationReports(extractorValidationReportRetentionLimit)
}

func sanitizeExtractorRunbookFilename(raw string) string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return "report"
	}
	replacer := strings.NewReplacer(
		"/", "-",
		"\\", "-",
		":", "-",
		" ", "-",
	)
	return replacer.Replace(raw)
}

func trimExtractorValidationReports(limit int) error {
	paths, err := listExtractorValidationReportPaths()
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

func listExtractorValidationReportPaths() ([]string, error) {
	matches, err := filepath.Glob(filepath.Join(extractorValidationReportsDir(), "*.json"))
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

func loadExtractorValidationReportSummaries(limit int) ([]ExtractorValidationReportSummary, error) {
	paths, err := listExtractorValidationReportPaths()
	if err != nil {
		return nil, err
	}
	if limit > 0 && len(paths) > limit {
		paths = paths[:limit]
	}
	summaries := make([]ExtractorValidationReportSummary, 0, len(paths))
	for _, path := range paths {
		report, err := loadExtractorValidationReport(path)
		if err != nil {
			continue
		}
		summaries = append(summaries, summarizeExtractorValidationReport(report))
	}
	if summaries == nil {
		summaries = []ExtractorValidationReportSummary{}
	}
	return summaries, nil
}

func loadExtractorValidationReport(path string) (*ExtractorValidationReport, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var report ExtractorValidationReport
	if err := json.Unmarshal(raw, &report); err != nil {
		return nil, err
	}
	return &report, nil
}

func summarizeExtractorValidationReport(report *ExtractorValidationReport) ExtractorValidationReportSummary {
	if report == nil {
		return ExtractorValidationReportSummary{
			PublicGate:        ExtractorValidationGateIncomplete,
			PrivateGate:       ExtractorValidationGateIncomplete,
			PublicFamilyGates: defaultExtractorPublicFamilyGates(),
		}
	}
	return ExtractorValidationReportSummary{
		ReportID:          strings.TrimSpace(report.ReportID),
		CreatedAt:         strings.TrimSpace(report.CreatedAt),
		ConfigUpdatedAt:   strings.TrimSpace(report.ConfigUpdatedAt),
		TotalCases:        report.TotalCases,
		PassedCases:       report.PassedCases,
		MismatchCases:     report.MismatchCases,
		FailedCases:       report.FailedCases,
		InvalidCases:      report.InvalidCases,
		PublicGate:        report.PublicGate,
		PrivateGate:       report.PrivateGate,
		PublicFamilyGates: report.PublicFamilyGates,
	}
}

func resolveExtractorValidationGates(
	config ExtractorRunbookConfig,
	summaries []ExtractorValidationReportSummary,
) (ExtractorValidationGate, ExtractorValidationGate, ExtractorPublicFamilyGates) {
	publicEnabled := false
	privateEnabled := false
	familyEnabled := defaultExtractorPublicFamilyGates()
	for _, preset := range config.Presets {
		if !preset.Enabled {
			continue
		}
		switch preset.Scope {
		case ExtractorValidationScopePublic:
			publicEnabled = true
			if family, ok := extractorValidationFamilyForPreset(preset); ok {
				summary := extractorFamilyGateByName(familyEnabled, family)
				summary.EnabledCases++
				assignExtractorFamilyGateSummary(&familyEnabled, family, summary)
			}
		case ExtractorValidationScopePrivate:
			privateEnabled = true
		}
	}

	publicGate := ExtractorValidationGateIncomplete
	privateGate := ExtractorValidationGateIncomplete
	publicFamilyGates := familyEnabled
	configUpdatedAt := strings.TrimSpace(config.UpdatedAt)
	for _, summary := range summaries {
		if configUpdatedAt == "" || strings.TrimSpace(summary.ConfigUpdatedAt) != configUpdatedAt {
			continue
		}
		publicGate = summary.PublicGate
		privateGate = summary.PrivateGate
		publicFamilyGates = summary.PublicFamilyGates
		break
	}
	if !publicEnabled {
		publicGate = ExtractorValidationGateIncomplete
	}
	if !privateEnabled {
		privateGate = ExtractorValidationGateIncomplete
	}
	if familyEnabled.Media.EnabledCases == 0 {
		publicFamilyGates.Media = defaultExtractorFamilyGateSummary()
	} else if publicFamilyGates.Media.EnabledCases == 0 {
		publicFamilyGates.Media.EnabledCases = familyEnabled.Media.EnabledCases
		publicFamilyGates.Media.Gate = ExtractorValidationGateIncomplete
	}
	if familyEnabled.Timeline.EnabledCases == 0 {
		publicFamilyGates.Timeline = defaultExtractorFamilyGateSummary()
	} else if publicFamilyGates.Timeline.EnabledCases == 0 {
		publicFamilyGates.Timeline.EnabledCases = familyEnabled.Timeline.EnabledCases
		publicFamilyGates.Timeline.Gate = ExtractorValidationGateIncomplete
	}
	if familyEnabled.DateRange.EnabledCases == 0 {
		publicFamilyGates.DateRange = defaultExtractorFamilyGateSummary()
	} else if publicFamilyGates.DateRange.EnabledCases == 0 {
		publicFamilyGates.DateRange.EnabledCases = familyEnabled.DateRange.EnabledCases
		publicFamilyGates.DateRange.Gate = ExtractorValidationGateIncomplete
	}
	return publicGate, privateGate, publicFamilyGates
}

func assignExtractorFamilyGateSummary(
	gates *ExtractorPublicFamilyGates,
	family ExtractorRequestFamily,
	summary ExtractorFamilyGateSummary,
) {
	if gates == nil {
		return
	}
	switch family {
	case ExtractorRequestFamilyMedia:
		gates.Media = summary
	case ExtractorRequestFamilyTimeline:
		gates.Timeline = summary
	case ExtractorRequestFamilyDateRange:
		gates.DateRange = summary
	}
}
