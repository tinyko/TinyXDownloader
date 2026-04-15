package backend

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"strings"
	"sync/atomic"
	"time"
)

const ExtractorEngineEnv = "XDOWNLOADER_EXTRACTOR_ENGINE"

type ExtractorEngineMode string

const (
	ExtractorEngineModePython ExtractorEngineMode = "python"
	ExtractorEngineModeGo     ExtractorEngineMode = "go"
	ExtractorEngineModeAuto   ExtractorEngineMode = "auto"
)

var (
	ErrEngineUnsupported      = errors.New("extractor engine unsupported")
	ErrEngineFallbackRequired = errors.New("extractor engine fallback required")
)

type ExtractorEngine interface {
	Name() string
	ExtractTimeline(ctx context.Context, req TimelineRequest) (*TwitterResponse, error)
	ExtractDateRange(ctx context.Context, req DateRangeRequest) (*TwitterResponse, error)
}

type extractorEngineCapabilityReporter interface {
	TimelineSupport(req TimelineRequest) (bool, string)
	DateRangeSupport(req DateRangeRequest) (bool, string)
}

type ExtractorEngineError struct {
	Engine string `json:"engine"`
	Reason string `json:"reason"`
	cause  error
}

func (e *ExtractorEngineError) Error() string {
	if e == nil {
		return ""
	}
	switch {
	case e.Engine != "" && e.Reason != "":
		return fmt.Sprintf("%s: %s", e.Engine, e.Reason)
	case e.Engine != "":
		return e.Engine
	case e.Reason != "":
		return e.Reason
	default:
		return "extractor engine error"
	}
}

func (e *ExtractorEngineError) Unwrap() error {
	if e == nil {
		return nil
	}
	return e.cause
}

func newEngineUnsupportedError(engine string, reason string) error {
	return &ExtractorEngineError{
		Engine: strings.TrimSpace(engine),
		Reason: strings.TrimSpace(reason),
		cause:  ErrEngineUnsupported,
	}
}

func newEngineFallbackRequiredError(engine string, reason string, err error) error {
	cause := ErrEngineFallbackRequired
	if err != nil {
		cause = errors.Join(ErrEngineFallbackRequired, err)
	}
	return &ExtractorEngineError{
		Engine: strings.TrimSpace(engine),
		Reason: strings.TrimSpace(reason),
		cause:  cause,
	}
}

type ExtractorMetricsSnapshot struct {
	TotalRequests            uint64 `json:"total_requests"`
	PythonModeRequests       uint64 `json:"python_mode_requests"`
	GoModeRequests           uint64 `json:"go_mode_requests"`
	AutoModeRequests         uint64 `json:"auto_mode_requests"`
	PythonEngineSelected     uint64 `json:"python_engine_selected"`
	GoEngineSelected         uint64 `json:"go_engine_selected"`
	FallbackCount            uint64 `json:"fallback_count"`
	UnsupportedCount         uint64 `json:"unsupported_count"`
	FallbackRequiredCount    uint64 `json:"fallback_required_count"`
	ParityComparisons        uint64 `json:"parity_comparisons"`
	ParityMismatches         uint64 `json:"parity_mismatches"`
	RolloutTrialRequests     uint64 `json:"rollout_trial_requests"`
	RolloutTrialPythonBypass uint64 `json:"rollout_trial_python_bypass"`
	RolloutTrialGoSelected   uint64 `json:"rollout_trial_go_selected"`
}

var extractorMetrics struct {
	totalRequests            uint64
	pythonModeRequests       uint64
	goModeRequests           uint64
	autoModeRequests         uint64
	pythonEngineSelected     uint64
	goEngineSelected         uint64
	fallbackCount            uint64
	unsupportedCount         uint64
	fallbackRequiredCount    uint64
	parityComparisons        uint64
	parityMismatches         uint64
	rolloutTrialRequests     uint64
	rolloutTrialPythonBypass uint64
	rolloutTrialGoSelected   uint64
}

type extractorRequestLogEntry struct {
	Event           string                    `json:"event"`
	RequestKind     string                    `json:"request_kind"`
	Mode            ExtractorEngineMode       `json:"mode,omitempty"`
	ConfiguredMode  ExtractorEngineMode       `json:"configured_mode,omitempty"`
	EffectiveMode   ExtractorEngineMode       `json:"effective_mode,omitempty"`
	ModeSource      string                    `json:"mode_source,omitempty"`
	RequestFamily   ExtractorRequestFamily    `json:"request_family,omitempty"`
	TrialArmed      bool                      `json:"trial_armed,omitempty"`
	TrialActive     bool                      `json:"trial_active,omitempty"`
	SelectedEngine  string                    `json:"selected_engine,omitempty"`
	FallbackFrom    string                    `json:"fallback_from,omitempty"`
	FallbackReason  string                    `json:"fallback_reason,omitempty"`
	FallbackCode    string                    `json:"fallback_code,omitempty"`
	SupportReason   string                    `json:"support_reason,omitempty"`
	Username        string                    `json:"username,omitempty"`
	TimelineType    string                    `json:"timeline_type,omitempty"`
	MediaType       string                    `json:"media_type,omitempty"`
	Retweets        bool                      `json:"retweets,omitempty"`
	QueryKey        string                    `json:"query_key,omitempty"`
	StartDate       string                    `json:"start_date,omitempty"`
	EndDate         string                    `json:"end_date,omitempty"`
	ElapsedMS       int64                     `json:"elapsed_ms,omitempty"`
	Success         bool                      `json:"success"`
	ResponseSummary *ExtractorResponseSummary `json:"response_summary,omitempty"`
	Error           string                    `json:"error,omitempty"`
}

type extractorRuntimeTrace struct {
	ConfiguredMode ExtractorEngineMode    `json:"configured_mode,omitempty"`
	EffectiveMode  ExtractorEngineMode    `json:"effective_mode,omitempty"`
	ModeSource     string                 `json:"mode_source,omitempty"`
	RequestFamily  ExtractorRequestFamily `json:"request_family,omitempty"`
	SelectedEngine string                 `json:"selected_engine,omitempty"`
	FallbackFrom   string                 `json:"fallback_from,omitempty"`
	FallbackReason string                 `json:"fallback_reason,omitempty"`
	FallbackCode   string                 `json:"fallback_code,omitempty"`
}

func parseExtractorEngineMode(value string) ExtractorEngineMode {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case string(ExtractorEngineModeGo):
		return ExtractorEngineModeGo
	case string(ExtractorEngineModeAuto):
		return ExtractorEngineModeAuto
	case string(ExtractorEngineModePython):
		return ExtractorEngineModePython
	case "":
		return ExtractorEngineModeGo
	default:
		return ExtractorEngineModeGo
	}
}

func currentExtractorEngineMode() ExtractorEngineMode {
	return parseExtractorEngineMode(os.Getenv(ExtractorEngineEnv))
}

func GetExtractorMetricsSnapshot() ExtractorMetricsSnapshot {
	return ExtractorMetricsSnapshot{
		TotalRequests:            atomic.LoadUint64(&extractorMetrics.totalRequests),
		PythonModeRequests:       atomic.LoadUint64(&extractorMetrics.pythonModeRequests),
		GoModeRequests:           atomic.LoadUint64(&extractorMetrics.goModeRequests),
		AutoModeRequests:         atomic.LoadUint64(&extractorMetrics.autoModeRequests),
		PythonEngineSelected:     atomic.LoadUint64(&extractorMetrics.pythonEngineSelected),
		GoEngineSelected:         atomic.LoadUint64(&extractorMetrics.goEngineSelected),
		FallbackCount:            atomic.LoadUint64(&extractorMetrics.fallbackCount),
		UnsupportedCount:         atomic.LoadUint64(&extractorMetrics.unsupportedCount),
		FallbackRequiredCount:    atomic.LoadUint64(&extractorMetrics.fallbackRequiredCount),
		ParityComparisons:        atomic.LoadUint64(&extractorMetrics.parityComparisons),
		ParityMismatches:         atomic.LoadUint64(&extractorMetrics.parityMismatches),
		RolloutTrialRequests:     atomic.LoadUint64(&extractorMetrics.rolloutTrialRequests),
		RolloutTrialPythonBypass: atomic.LoadUint64(&extractorMetrics.rolloutTrialPythonBypass),
		RolloutTrialGoSelected:   atomic.LoadUint64(&extractorMetrics.rolloutTrialGoSelected),
	}
}

func newPythonGalleryDLEngine() ExtractorEngine {
	return &PythonGalleryDLEngine{}
}

func newGoTwitterEngine() ExtractorEngine {
	return &GoTwitterEngine{
		clientFactory: defaultXAPIClient,
	}
}

func incrementExtractorModeCount(mode ExtractorEngineMode) {
	atomic.AddUint64(&extractorMetrics.totalRequests, 1)
	switch mode {
	case ExtractorEngineModeGo:
		atomic.AddUint64(&extractorMetrics.goModeRequests, 1)
	case ExtractorEngineModeAuto:
		atomic.AddUint64(&extractorMetrics.autoModeRequests, 1)
	default:
		atomic.AddUint64(&extractorMetrics.pythonModeRequests, 1)
	}
}

func incrementSelectedEngineCount(engineName string) {
	switch strings.TrimSpace(engineName) {
	case "go-twitter":
		atomic.AddUint64(&extractorMetrics.goEngineSelected, 1)
	default:
		atomic.AddUint64(&extractorMetrics.pythonEngineSelected, 1)
	}
}

func incrementFallbackCount() {
	atomic.AddUint64(&extractorMetrics.fallbackCount, 1)
}

func incrementUnsupportedCount() {
	atomic.AddUint64(&extractorMetrics.unsupportedCount, 1)
}

func incrementFallbackRequiredCount() {
	atomic.AddUint64(&extractorMetrics.fallbackRequiredCount, 1)
}

func incrementRolloutTrialRequestCount() {
	atomic.AddUint64(&extractorMetrics.rolloutTrialRequests, 1)
}

func incrementRolloutTrialPythonBypassCount() {
	atomic.AddUint64(&extractorMetrics.rolloutTrialPythonBypass, 1)
}

func incrementRolloutTrialGoSelectedCount() {
	atomic.AddUint64(&extractorMetrics.rolloutTrialGoSelected, 1)
}

func incrementParityComparisonCount(equal bool) {
	atomic.AddUint64(&extractorMetrics.parityComparisons, 1)
	if !equal {
		atomic.AddUint64(&extractorMetrics.parityMismatches, 1)
	}
}

func appendExtractorLog(entry extractorRequestLogEntry) {
	recordExtractorRequestLogEntry(entry)
	recordExtractorSoakRequest(entry)
	data, err := json.Marshal(entry)
	if err != nil {
		return
	}
	_ = AppendBackendDiagnosticLog("info", string(data))
}

func timelineSupport(engine ExtractorEngine, req TimelineRequest) (bool, string) {
	if reporter, ok := engine.(extractorEngineCapabilityReporter); ok {
		return reporter.TimelineSupport(req)
	}
	return true, ""
}

func dateRangeSupport(engine ExtractorEngine, req DateRangeRequest) (bool, string) {
	if reporter, ok := engine.(extractorEngineCapabilityReporter); ok {
		return reporter.DateRangeSupport(req)
	}
	return true, ""
}

func extractTimelineWithEngines(
	ctx context.Context,
	req TimelineRequest,
	mode ExtractorEngineMode,
	pythonEngine ExtractorEngine,
	goEngine ExtractorEngine,
) (*TwitterResponse, error) {
	response, _, err := extractTimelineWithEngineOverride(ctx, req, mode, pythonEngine, goEngine, nil)
	return response, err
}

func extractTimelineWithEngineOverride(
	ctx context.Context,
	req TimelineRequest,
	mode ExtractorEngineMode,
	_ ExtractorEngine,
	goEngine ExtractorEngine,
	override *extractorExecutionOverride,
) (*TwitterResponse, extractorRuntimeTrace, error) {
	resolution := resolveTimelineExtractorModeForExecution(mode, req, override)
	trace := extractorRuntimeTrace{
		ConfiguredMode: resolution.ConfiguredMode,
		EffectiveMode:  resolution.EffectiveMode,
		ModeSource:     resolution.ModeSource,
		RequestFamily:  resolution.RequestFamily,
	}
	incrementExtractorModeCount(resolution.ConfiguredMode)
	if resolution.ModeSource == "rollout_policy" {
		incrementRolloutTrialRequestCount()
		if !resolution.TrialActive {
			incrementRolloutTrialPythonBypassCount()
		}
	}
	trace.SelectedEngine = goEngine.Name()
	response, err := runTimelineEngine(ctx, req, resolution, goEngine, "", "", "")
	if err != nil {
		trace.FallbackReason = err.Error()
		trace.FallbackCode = fallbackCodeForError(err)
	}
	return response, trace, err
}

func timelineAutoBypassReason(req TimelineRequest) (string, bool) {
	return "", false
}

func extractDateRangeWithEngines(
	ctx context.Context,
	req DateRangeRequest,
	mode ExtractorEngineMode,
	pythonEngine ExtractorEngine,
	goEngine ExtractorEngine,
) (*TwitterResponse, error) {
	response, _, err := extractDateRangeWithEngineOverride(ctx, req, mode, pythonEngine, goEngine, nil)
	return response, err
}

func extractDateRangeWithEngineOverride(
	ctx context.Context,
	req DateRangeRequest,
	mode ExtractorEngineMode,
	_ ExtractorEngine,
	goEngine ExtractorEngine,
	override *extractorExecutionOverride,
) (*TwitterResponse, extractorRuntimeTrace, error) {
	resolution := resolveDateRangeExtractorModeForExecution(mode, req, override)
	trace := extractorRuntimeTrace{
		ConfiguredMode: resolution.ConfiguredMode,
		EffectiveMode:  resolution.EffectiveMode,
		ModeSource:     resolution.ModeSource,
		RequestFamily:  resolution.RequestFamily,
	}
	incrementExtractorModeCount(resolution.ConfiguredMode)
	if resolution.ModeSource == "rollout_policy" {
		incrementRolloutTrialRequestCount()
		if !resolution.TrialActive {
			incrementRolloutTrialPythonBypassCount()
		}
	}
	trace.SelectedEngine = goEngine.Name()
	response, err := runDateRangeEngine(ctx, req, resolution, goEngine, "", "", "")
	if err != nil {
		trace.FallbackReason = err.Error()
		trace.FallbackCode = fallbackCodeForError(err)
	}
	return response, trace, err
}

func fallbackCodeForError(err error) string {
	switch {
	case errors.Is(err, ErrExtractorControlRetired):
		return "retired"
	case errors.Is(err, ErrEngineFallbackRequired):
		return "fallback_required"
	case errors.Is(err, ErrEngineUnsupported):
		return "unsupported"
	case err != nil:
		return "engine_error"
	default:
		return ""
	}
}

func runTimelineEngine(
	ctx context.Context,
	req TimelineRequest,
	resolution extractorModeResolution,
	engine ExtractorEngine,
	fallbackFrom string,
	fallbackReason string,
	fallbackCode string,
) (*TwitterResponse, error) {
	startedAt := time.Now()
	incrementSelectedEngineCount(engine.Name())
	if resolution.ModeSource == "rollout_policy" && resolution.TrialActive && strings.TrimSpace(engine.Name()) == "go-twitter" {
		incrementRolloutTrialGoSelectedCount()
	}

	response, err := engine.ExtractTimeline(ctx, req)
	resolvedFallbackCode := strings.TrimSpace(fallbackCode)
	if resolvedFallbackCode == "" {
		resolvedFallbackCode = fallbackCodeForError(err)
	}
	appendExtractorLog(extractorRequestLogEntry{
		Event:           "extractor_request",
		RequestKind:     "timeline",
		Mode:            resolution.EffectiveMode,
		ConfiguredMode:  resolution.ConfiguredMode,
		EffectiveMode:   resolution.EffectiveMode,
		ModeSource:      resolution.ModeSource,
		RequestFamily:   resolution.RequestFamily,
		TrialArmed:      resolution.TrialArmed,
		TrialActive:     resolution.TrialActive,
		SelectedEngine:  engine.Name(),
		FallbackFrom:    fallbackFrom,
		FallbackReason:  strings.TrimSpace(fallbackReason),
		FallbackCode:    resolvedFallbackCode,
		Username:        strings.TrimSpace(req.Username),
		TimelineType:    strings.TrimSpace(req.TimelineType),
		MediaType:       strings.TrimSpace(req.MediaType),
		Retweets:        req.Retweets,
		QueryKey:        "",
		ElapsedMS:       time.Since(startedAt).Milliseconds(),
		Success:         err == nil,
		ResponseSummary: summarizeTwitterResponse(response),
		Error:           errorString(err),
	})
	return response, err
}

func runDateRangeEngine(
	ctx context.Context,
	req DateRangeRequest,
	resolution extractorModeResolution,
	engine ExtractorEngine,
	fallbackFrom string,
	fallbackReason string,
	fallbackCode string,
) (*TwitterResponse, error) {
	startedAt := time.Now()
	incrementSelectedEngineCount(engine.Name())
	if resolution.ModeSource == "rollout_policy" && resolution.TrialActive && strings.TrimSpace(engine.Name()) == "go-twitter" {
		incrementRolloutTrialGoSelectedCount()
	}

	response, err := engine.ExtractDateRange(ctx, req)
	resolvedFallbackCode := strings.TrimSpace(fallbackCode)
	if resolvedFallbackCode == "" {
		resolvedFallbackCode = fallbackCodeForError(err)
	}
	appendExtractorLog(extractorRequestLogEntry{
		Event:           "extractor_request",
		RequestKind:     "date_range",
		Mode:            resolution.EffectiveMode,
		ConfiguredMode:  resolution.ConfiguredMode,
		EffectiveMode:   resolution.EffectiveMode,
		ModeSource:      resolution.ModeSource,
		RequestFamily:   resolution.RequestFamily,
		TrialArmed:      resolution.TrialArmed,
		TrialActive:     resolution.TrialActive,
		SelectedEngine:  engine.Name(),
		FallbackFrom:    fallbackFrom,
		FallbackReason:  strings.TrimSpace(fallbackReason),
		FallbackCode:    resolvedFallbackCode,
		Username:        strings.TrimSpace(req.Username),
		StartDate:       strings.TrimSpace(req.StartDate),
		EndDate:         strings.TrimSpace(req.EndDate),
		MediaType:       strings.TrimSpace(req.MediaFilter),
		Retweets:        req.Retweets,
		ElapsedMS:       time.Since(startedAt).Milliseconds(),
		Success:         err == nil,
		ResponseSummary: summarizeTwitterResponse(response),
		Error:           errorString(err),
	})
	return response, err
}

func errorString(err error) string {
	if err == nil {
		return ""
	}
	return err.Error()
}
