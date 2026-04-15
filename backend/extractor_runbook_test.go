package backend

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestExtractorRunbookSnapshotIncludesConfigAndLatestGate(t *testing.T) {
	withTempAppData(t, func(root string) {
		_ = root
		resetExtractorDiagnosticsForTests()

		savedConfig, err := SaveExtractorRunbookConfig(ExtractorRunbookConfig{
			Presets: []ExtractorRunbookPreset{
				{
					ID:           "public-timeline",
					Label:        "Public NASA timeline",
					Enabled:      true,
					RequestKind:  "timeline",
					Scope:        ExtractorValidationScopePublic,
					Username:     "nasa",
					TimelineType: "timeline",
					MediaType:    "all",
				},
				{
					ID:           "private-bookmarks",
					Label:        "My bookmarks",
					Enabled:      true,
					RequestKind:  "timeline",
					Scope:        ExtractorValidationScopePrivate,
					TimelineType: "bookmarks",
					MediaType:    "text",
				},
			},
		})
		if err != nil {
			t.Fatalf("save runbook config: %v", err)
		}

		report := &ExtractorValidationReport{
			ReportID:        "report-1",
			CreatedAt:       "2026-04-15T06:00:00Z",
			ConfigUpdatedAt: savedConfig.UpdatedAt,
			AppVersion:      "1.2.3",
			EngineMode:      ExtractorEngineModePython,
			PublicGate:      ExtractorValidationGateReady,
			PrivateGate:     ExtractorValidationGateBlocked,
			Cases: []ExtractorValidationCaseReport{
				{
					PresetID:      "public-timeline",
					PresetLabel:   "Public NASA timeline",
					RequestKind:   "timeline",
					Scope:         ExtractorValidationScopePublic,
					Target:        "@nasa timeline [all]",
					Valid:         true,
					GoSupported:   true,
					PythonSuccess: true,
					GoSuccess:     true,
					Equal:         true,
				},
				{
					PresetID:      "private-bookmarks",
					PresetLabel:   "My bookmarks",
					RequestKind:   "timeline",
					Scope:         ExtractorValidationScopePrivate,
					Target:        "private bookmarks [text]",
					Valid:         true,
					GoSupported:   true,
					PythonSuccess: true,
					GoSuccess:     true,
					Equal:         false,
					DiffCount:     1,
				},
			},
		}
		applyExtractorValidationSummary(report)
		if err := saveExtractorValidationReport(report); err != nil {
			t.Fatalf("save validation report: %v", err)
		}

		snapshot := GetExtractorDiagnosticsSnapshot()
		if len(snapshot.RunbookConfig.Presets) != 2 {
			t.Fatalf("expected 2 runbook presets, got %d", len(snapshot.RunbookConfig.Presets))
		}
		if len(snapshot.RecentValidationReports) != 1 {
			t.Fatalf("expected 1 recent validation report, got %d", len(snapshot.RecentValidationReports))
		}
		if snapshot.PublicGate != ExtractorValidationGateReady {
			t.Fatalf("expected public gate ready, got %q", snapshot.PublicGate)
		}
		if snapshot.PrivateGate != ExtractorValidationGateBlocked {
			t.Fatalf("expected private gate blocked, got %q", snapshot.PrivateGate)
		}
	})
}

func TestRunExtractorValidationRunbookMixedScopes(t *testing.T) {
	withTempAppData(t, func(root string) {
		_ = root
		resetExtractorDiagnosticsForTests()

		previousTimelineCompare := compareTimelineExtractorParityFn
		previousDateRangeCompare := compareDateRangeExtractorParityFn
		t.Cleanup(func() {
			compareTimelineExtractorParityFn = previousTimelineCompare
			compareDateRangeExtractorParityFn = previousDateRangeCompare
		})

		timelineCalls := 0
		dateRangeCalls := 0
		compareTimelineExtractorParityFn = func(req TimelineRequest) (*ExtractorParityReport, error) {
			timelineCalls++
			switch req.TimelineType {
			case "timeline":
				return &ExtractorParityReport{
					RequestKind:   "timeline",
					GoSupported:   true,
					PythonSuccess: true,
					GoSuccess:     true,
					Equal:         true,
				}, nil
			case "bookmarks":
				return &ExtractorParityReport{
					RequestKind:   "timeline",
					GoSupported:   true,
					PythonSuccess: true,
					GoSuccess:     true,
					Equal:         true,
				}, nil
			default:
				t.Fatalf("unexpected timeline type %q", req.TimelineType)
				return nil, nil
			}
		}
		compareDateRangeExtractorParityFn = func(req DateRangeRequest) (*ExtractorParityReport, error) {
			dateRangeCalls++
			return &ExtractorParityReport{
				RequestKind:   "date_range",
				GoSupported:   true,
				PythonSuccess: true,
				GoSuccess:     true,
				Equal:         true,
			}, nil
		}

		_, err := SaveExtractorRunbookConfig(ExtractorRunbookConfig{
			Presets: []ExtractorRunbookPreset{
				{
					ID:           "public-timeline",
					Label:        "Public timeline",
					Enabled:      true,
					RequestKind:  "timeline",
					Scope:        ExtractorValidationScopePublic,
					Username:     "nasa",
					TimelineType: "timeline",
					MediaType:    "all",
				},
				{
					ID:           "private-bookmarks",
					Label:        "Private bookmarks",
					Enabled:      true,
					RequestKind:  "timeline",
					Scope:        ExtractorValidationScopePrivate,
					TimelineType: "bookmarks",
					MediaType:    "text",
				},
				{
					ID:          "invalid-date-range",
					Label:       "Broken date range",
					Enabled:     true,
					RequestKind: "date_range",
					Scope:       ExtractorValidationScopePublic,
					Username:    "nasa",
					MediaType:   "image",
					StartDate:   "2026-04-01",
				},
			},
		})
		if err != nil {
			t.Fatalf("save runbook config: %v", err)
		}

		report, err := RunExtractorValidationRunbook("1.2.3", ExtractorValidationRunRequest{
			PublicAuthToken:  "public-token",
			PrivateAuthToken: "private-token",
		})
		if err != nil {
			t.Fatalf("run validation runbook: %v", err)
		}

		if timelineCalls != 2 {
			t.Fatalf("expected 2 timeline parity calls, got %d", timelineCalls)
		}
		if dateRangeCalls != 0 {
			t.Fatalf("expected invalid date-range preset to be skipped, got %d calls", dateRangeCalls)
		}
		if report.TotalCases != 3 {
			t.Fatalf("expected 3 evaluated cases, got %d", report.TotalCases)
		}
		if report.PassedCases != 2 {
			t.Fatalf("expected 2 passed cases, got %d", report.PassedCases)
		}
		if report.InvalidCases != 1 {
			t.Fatalf("expected 1 invalid case, got %d", report.InvalidCases)
		}
		if report.PublicGate != ExtractorValidationGateIncomplete {
			t.Fatalf("expected public gate incomplete, got %q", report.PublicGate)
		}
		if report.PrivateGate != ExtractorValidationGateReady {
			t.Fatalf("expected private gate ready, got %q", report.PrivateGate)
		}
		if len(report.Cases) != 3 || report.Cases[2].SkippedReason == "" {
			t.Fatalf("expected invalid preset to record skipped reason: %+v", report.Cases)
		}
	})
}

func TestExtractorValidationReportRetentionAndSupportBundleEvidence(t *testing.T) {
	withTempAppData(t, func(root string) {
		resetExtractorDiagnosticsForTests()
		if err := InitDB(); err != nil {
			t.Fatalf("init db: %v", err)
		}
		insertTestAccountRecord(t, "report_bundle_user")

		savedConfig, err := SaveExtractorRunbookConfig(ExtractorRunbookConfig{
			Presets: []ExtractorRunbookPreset{
				{
					ID:           "public-timeline",
					Label:        "Public timeline",
					Enabled:      true,
					RequestKind:  "timeline",
					Scope:        ExtractorValidationScopePublic,
					Username:     "nasa",
					TimelineType: "timeline",
					MediaType:    "all",
				},
			},
		})
		if err != nil {
			t.Fatalf("save runbook config: %v", err)
		}

		previousNow := extractorRunbookNow
		t.Cleanup(func() {
			extractorRunbookNow = previousNow
		})
		baseTime := time.Date(2026, 4, 15, 8, 0, 0, 0, time.UTC)
		callIndex := 0
		extractorRunbookNow = func() time.Time {
			next := baseTime.Add(time.Duration(callIndex) * time.Second)
			callIndex++
			return next
		}

		for index := 0; index < extractorValidationReportRetentionLimit+5; index++ {
			report := &ExtractorValidationReport{
				ReportID:        "report-" + strings.TrimSpace(time.Date(2026, 4, 15, 0, 0, index, 0, time.UTC).Format("150405")),
				CreatedAt:       baseTime.Add(time.Duration(index) * time.Second).Format(time.RFC3339),
				ConfigUpdatedAt: savedConfig.UpdatedAt,
				AppVersion:      "1.2.3",
				EngineMode:      ExtractorEngineModePython,
				Diagnostics: ExtractorValidationDiagnosticsSummary{
					CurrentMode:   currentExtractorEngineMode(),
					SupportMatrix: buildExtractorSupportMatrixSummary(),
					Metrics:       GetExtractorMetricsSnapshot(),
				},
				Cases: []ExtractorValidationCaseReport{
					{
						PresetID:      "public-timeline",
						PresetLabel:   "Public timeline",
						RequestKind:   "timeline",
						Scope:         ExtractorValidationScopePublic,
						Target:        "@nasa timeline [all]",
						Valid:         true,
						GoSupported:   true,
						PythonSuccess: true,
						GoSuccess:     true,
						Equal:         true,
					},
				},
			}
			applyExtractorValidationSummary(report)
			if err := saveExtractorValidationReport(report); err != nil {
				t.Fatalf("save validation report %d: %v", index, err)
			}
		}

		reportPaths, err := listExtractorValidationReportPaths()
		if err != nil {
			t.Fatalf("list validation reports: %v", err)
		}
		if len(reportPaths) != extractorValidationReportRetentionLimit {
			t.Fatalf("expected %d retained reports, got %d", extractorValidationReportRetentionLimit, len(reportPaths))
		}

		outputPath := filepath.Join(root, "support-runbook.zip")
		if err := ExportSupportBundle(outputPath, SupportBundleOptions{
			AppName:    "TinyXDownloader",
			AppVersion: "1.2.3",
		}); err != nil {
			t.Fatalf("export support bundle: %v", err)
		}

		entries := readZipEntries(t, outputPath)
		runbookJSON, ok := entries["extractor_runbook.json"]
		if !ok {
			t.Fatal("expected extractor_runbook.json entry")
		}
		if strings.Contains(runbookJSON, "public-token") || strings.Contains(runbookJSON, "private-token") {
			t.Fatalf("runbook config should not contain tokens: %s", runbookJSON)
		}

		reportEntryCount := 0
		for name, body := range entries {
			if strings.HasPrefix(name, "extractor_reports/") {
				reportEntryCount++
				if strings.Contains(body, "public-token") || strings.Contains(body, "private-token") {
					t.Fatalf("validation report should not contain tokens: %s", name)
				}
			}
		}
		if reportEntryCount != extractorValidationReportSupportBundleLimit {
			t.Fatalf("expected %d report entries in support bundle, got %d", extractorValidationReportSupportBundleLimit, reportEntryCount)
		}

		configPath := extractorRunbookConfigPath()
		rawConfig, err := os.ReadFile(configPath)
		if err != nil {
			t.Fatalf("read runbook config: %v", err)
		}
		var decodedConfig ExtractorRunbookConfig
		if err := json.Unmarshal(rawConfig, &decodedConfig); err != nil {
			t.Fatalf("decode runbook config: %v", err)
		}
		if len(decodedConfig.Presets) != 1 {
			t.Fatalf("expected saved runbook config to contain 1 preset, got %d", len(decodedConfig.Presets))
		}
	})
}
