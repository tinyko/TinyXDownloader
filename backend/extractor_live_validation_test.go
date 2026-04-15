package backend

import (
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestRunExtractorLiveValidationSessionExecutesPublicAndPrivatePresets(t *testing.T) {
	withTempAppData(t, func(root string) {
		_ = root
		resetExtractorDiagnosticsForTests()

		previousTimelineCompare := compareTimelineExtractorParityFn
		previousDateRangeCompare := compareDateRangeExtractorParityFn
		previousTimelineLive := runTimelineLiveCandidateFn
		previousDateRangeLive := runDateRangeLiveCandidateFn
		t.Cleanup(func() {
			compareTimelineExtractorParityFn = previousTimelineCompare
			compareDateRangeExtractorParityFn = previousDateRangeCompare
			runTimelineLiveCandidateFn = previousTimelineLive
			runDateRangeLiveCandidateFn = previousDateRangeLive
		})

		timelineParityCalls := 0
		timelineLiveCalls := 0
		compareTimelineExtractorParityFn = func(req TimelineRequest) (*ExtractorParityReport, error) {
			timelineParityCalls++
			switch req.TimelineType {
			case "media":
				if req.AuthToken != "public-token" {
					t.Fatalf("expected public token for media parity, got %+v", req)
				}
			case "bookmarks":
				if req.AuthToken != "private-token" {
					t.Fatalf("expected private token for bookmarks parity, got %+v", req)
				}
			default:
				t.Fatalf("unexpected timeline parity request: %+v", req)
			}
			return &ExtractorParityReport{
				RequestKind:   "timeline",
				GoSupported:   true,
				PythonSuccess: true,
				GoSuccess:     true,
				Equal:         true,
			}, nil
		}
		compareDateRangeExtractorParityFn = func(req DateRangeRequest) (*ExtractorParityReport, error) {
			t.Fatalf("unexpected date-range parity request: %+v", req)
			return nil, nil
		}
		runTimelineLiveCandidateFn = func(req TimelineRequest, family ExtractorRequestFamily) (*TwitterResponse, extractorRuntimeTrace, error) {
			timelineLiveCalls++
			switch family {
			case ExtractorRequestFamilyMedia:
				if req.TimelineType != "media" || req.AuthToken != "public-token" {
					t.Fatalf("unexpected public live request: %+v", req)
				}
			case ExtractorRequestFamilyBookmarks:
				if req.TimelineType != "bookmarks" || req.AuthToken != "private-token" {
					t.Fatalf("unexpected private live request: %+v", req)
				}
			default:
				t.Fatalf("unexpected live request: %+v", req)
			}
			return sampleTwitterResponse(), extractorRuntimeTrace{
				ConfiguredMode: ExtractorEngineModePython,
				EffectiveMode:  ExtractorEngineModeAuto,
				ModeSource:     "live_validation",
				RequestFamily:  ExtractorRequestFamilyMedia,
				SelectedEngine: "go-twitter",
			}, nil
		}
		runDateRangeLiveCandidateFn = func(req DateRangeRequest, family ExtractorRequestFamily) (*TwitterResponse, extractorRuntimeTrace, error) {
			t.Fatalf("unexpected live date-range request: %+v / %q", req, family)
			return nil, extractorRuntimeTrace{}, nil
		}

		savedConfig, err := SaveExtractorRunbookConfig(ExtractorRunbookConfig{
			Presets: []ExtractorRunbookPreset{
				{
					ID:           "public-media",
					Label:        "Public NASA media",
					Enabled:      true,
					RequestKind:  "timeline",
					Scope:        ExtractorValidationScopePublic,
					Username:     "nasa",
					TimelineType: "media",
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
			},
		})
		if err != nil {
			t.Fatalf("save runbook config: %v", err)
		}

		report, err := RunExtractorLiveValidationSession("1.2.3", ExtractorValidationRunRequest{
			PublicAuthToken:  "public-token",
			PrivateAuthToken: "private-token",
		})
		if err != nil {
			t.Fatalf("run live validation session: %v", err)
		}

		if timelineLiveCalls != 2 {
			t.Fatalf("expected 2 live timeline calls, got %d", timelineLiveCalls)
		}
		if timelineParityCalls != 2 {
			t.Fatalf("expected 2 timeline parity calls, got %d", timelineParityCalls)
		}
		if report.TotalCases != 2 {
			t.Fatalf("expected 2 report cases, got %d", report.TotalCases)
		}
		if report.RuntimePassedCases != 2 || report.RuntimeSkippedCases != 0 || report.RuntimeFailedCases != 0 {
			t.Fatalf("unexpected runtime counts: %+v", report)
		}
		if report.LiveFamilyGates.Media.Gate != ExtractorValidationGateReady {
			t.Fatalf("expected live media gate ready, got %q", report.LiveFamilyGates.Media.Gate)
		}
		if report.PromotionFamilyGates.Media.Gate != ExtractorValidationGateReady {
			t.Fatalf("expected promotion media gate ready, got %q", report.PromotionFamilyGates.Media.Gate)
		}
		if report.PrivateLiveFamilyGates.Bookmarks.Gate != ExtractorValidationGateReady {
			t.Fatalf("expected private live bookmarks gate ready, got %q", report.PrivateLiveFamilyGates.Bookmarks.Gate)
		}
		if report.PrivatePromotionFamilyGates.Bookmarks.Gate != ExtractorValidationGateReady {
			t.Fatalf("expected private promotion bookmarks gate ready, got %q", report.PrivatePromotionFamilyGates.Bookmarks.Gate)
		}
		if report.Cases[0].Runtime.ModeSource != "live_validation" {
			t.Fatalf("expected live candidate mode source, got %+v", report.Cases[0].Runtime)
		}
		if report.Cases[1].Runtime.ModeSource != "live_validation" {
			t.Fatalf("expected private live candidate mode source, got %+v", report.Cases[1].Runtime)
		}
		if report.ConfigUpdatedAt != savedConfig.UpdatedAt {
			t.Fatalf("expected config_updated_at %q, got %q", savedConfig.UpdatedAt, report.ConfigUpdatedAt)
		}

		snapshot := GetExtractorDiagnosticsSnapshot()
		if len(snapshot.RecentLiveReports) != 1 {
			t.Fatalf("expected 1 recent live report, got %d", len(snapshot.RecentLiveReports))
		}
		if snapshot.LiveFamilyGates.Media.Gate != ExtractorValidationGateReady {
			t.Fatalf("expected snapshot live media gate ready, got %q", snapshot.LiveFamilyGates.Media.Gate)
		}
		if snapshot.PromotionFamilyGates.Media.Gate != ExtractorValidationGateReady {
			t.Fatalf("expected snapshot promotion media gate ready, got %q", snapshot.PromotionFamilyGates.Media.Gate)
		}
		if snapshot.PrivateLiveFamilyGates.Bookmarks.Gate != ExtractorValidationGateReady {
			t.Fatalf("expected snapshot private live bookmarks gate ready, got %q", snapshot.PrivateLiveFamilyGates.Bookmarks.Gate)
		}
		if snapshot.PrivatePromotionFamilyGates.Bookmarks.Gate != ExtractorValidationGateReady {
			t.Fatalf("expected snapshot private promotion bookmarks gate ready, got %q", snapshot.PrivatePromotionFamilyGates.Bookmarks.Gate)
		}
	})
}

func TestExtractorLiveValidationReportRetentionAndSupportBundleEvidence(t *testing.T) {
	withTempAppData(t, func(root string) {
		resetExtractorDiagnosticsForTests()
		if err := InitDB(); err != nil {
			t.Fatalf("init db: %v", err)
		}
		insertTestAccountRecord(t, "live_bundle_user")

		previousNow := extractorRunbookNow
		t.Cleanup(func() {
			extractorRunbookNow = previousNow
		})
		baseTime := time.Date(2026, 4, 15, 9, 0, 0, 0, time.UTC)
		callIndex := 0
		extractorRunbookNow = func() time.Time {
			next := baseTime.Add(time.Duration(callIndex) * time.Second)
			callIndex++
			return next
		}

		for index := 0; index < extractorLiveValidationReportRetentionLimit+4; index++ {
			report := &ExtractorLiveValidationReport{
				ReportID:        "live-report-" + strings.TrimSpace(time.Date(2026, 4, 15, 0, 0, index, 0, time.UTC).Format("150405")),
				CreatedAt:       baseTime.Add(time.Duration(index) * time.Second).Format(time.RFC3339),
				ConfigUpdatedAt: "2026-04-15T08:59:00Z",
				AppVersion:      "1.2.3",
				EngineMode:      ExtractorEngineModePython,
				Cases: []ExtractorLiveValidationCaseReport{
					{
						PresetID:      "public-media",
						PresetLabel:   "Public media",
						RequestKind:   "timeline",
						Scope:         ExtractorValidationScopePublic,
						RequestFamily: ExtractorRequestFamilyMedia,
						Target:        "@nasa media [all]",
						Valid:         true,
						Runtime: ExtractorRuntimeValidationSummary{
							Status:         ExtractorRuntimeValidationStatusSuccess,
							ConfiguredMode: ExtractorEngineModePython,
							EffectiveMode:  ExtractorEngineModeAuto,
							ModeSource:     "live_validation",
							SelectedEngine: "go-twitter",
						},
						GoSupported:   true,
						PythonSuccess: true,
						GoSuccess:     true,
						Equal:         true,
					},
				},
			}
			applyExtractorLiveValidationSummary(report)
			if err := saveExtractorLiveValidationReport(report); err != nil {
				t.Fatalf("save live validation report %d: %v", index, err)
			}
		}

		reportPaths, err := listExtractorLiveValidationReportPaths()
		if err != nil {
			t.Fatalf("list live validation reports: %v", err)
		}
		if len(reportPaths) != extractorLiveValidationReportRetentionLimit {
			t.Fatalf("expected %d retained live reports, got %d", extractorLiveValidationReportRetentionLimit, len(reportPaths))
		}

		outputPath := filepath.Join(root, "support-live.zip")
		if err := ExportSupportBundle(outputPath, SupportBundleOptions{
			AppName:    "TinyXDownloader",
			AppVersion: "1.2.3",
		}); err != nil {
			t.Fatalf("export support bundle: %v", err)
		}

		entries := readZipEntries(t, outputPath)
		liveReportEntryCount := 0
		for name, body := range entries {
			if strings.HasPrefix(name, "extractor_live_reports/") {
				liveReportEntryCount++
				if strings.Contains(body, "public-token") || strings.Contains(body, "private-token") {
					t.Fatalf("live report should not contain tokens: %s", body)
				}
			}
		}
		if liveReportEntryCount != extractorLiveValidationReportSupportBundleLimit {
			t.Fatalf("expected %d live report entries, got %d", extractorLiveValidationReportSupportBundleLimit, liveReportEntryCount)
		}
	})
}
