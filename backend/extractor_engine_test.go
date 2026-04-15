package backend

import (
	"context"
	"errors"
	"reflect"
	"testing"
)

type stubExtractorEngine struct {
	name string

	timelineSupported bool
	timelineReason    string
	timelineResponse  *TwitterResponse
	timelineError     error
	timelineCalls     int

	dateRangeSupported bool
	dateRangeReason    string
	dateRangeResponse  *TwitterResponse
	dateRangeError     error
	dateRangeCalls     int
}

func (s *stubExtractorEngine) Name() string {
	return s.name
}

func (s *stubExtractorEngine) TimelineSupport(req TimelineRequest) (bool, string) {
	_ = req
	return s.timelineSupported, s.timelineReason
}

func (s *stubExtractorEngine) DateRangeSupport(req DateRangeRequest) (bool, string) {
	_ = req
	return s.dateRangeSupported, s.dateRangeReason
}

func (s *stubExtractorEngine) ExtractTimeline(ctx context.Context, req TimelineRequest) (*TwitterResponse, error) {
	_ = ctx
	_ = req
	s.timelineCalls++
	return s.timelineResponse, s.timelineError
}

func (s *stubExtractorEngine) ExtractDateRange(ctx context.Context, req DateRangeRequest) (*TwitterResponse, error) {
	_ = ctx
	_ = req
	s.dateRangeCalls++
	return s.dateRangeResponse, s.dateRangeError
}

func TestParseExtractorEngineModeDefaultsToGo(t *testing.T) {
	t.Run("empty", func(t *testing.T) {
		if got := parseExtractorEngineMode(""); got != ExtractorEngineModeGo {
			t.Fatalf("expected go mode, got %q", got)
		}
	})

	t.Run("invalid", func(t *testing.T) {
		if got := parseExtractorEngineMode("invalid"); got != ExtractorEngineModeGo {
			t.Fatalf("expected go mode, got %q", got)
		}
	})

	t.Run("go", func(t *testing.T) {
		if got := parseExtractorEngineMode("go"); got != ExtractorEngineModeGo {
			t.Fatalf("expected go mode, got %q", got)
		}
	})

	t.Run("auto", func(t *testing.T) {
		if got := parseExtractorEngineMode("auto"); got != ExtractorEngineModeAuto {
			t.Fatalf("expected auto mode, got %q", got)
		}
	})
}

func TestExtractTimelineWithEnginesAutoReturnsUnsupportedInGoOnlyRuntime(t *testing.T) {
	pythonEngine := &stubExtractorEngine{name: "python-gallery-dl"}
	goEngine := &stubExtractorEngine{
		name:              "go-twitter",
		timelineSupported: true,
		timelineError:     newEngineUnsupportedError("go-twitter", "not yet supported"),
	}

	response, err := extractTimelineWithEngines(context.Background(), TimelineRequest{Username: "example"}, ExtractorEngineModeAuto, pythonEngine, goEngine)
	if err == nil {
		t.Fatal("expected unsupported error")
	}
	if response != nil {
		t.Fatalf("expected nil response, got %#v", response)
	}
	if !errors.Is(err, ErrEngineUnsupported) {
		t.Fatalf("expected unsupported error, got %v", err)
	}
	if pythonEngine.timelineCalls != 0 || goEngine.timelineCalls != 1 {
		t.Fatalf("expected only go engine to run, got go=%d python=%d", goEngine.timelineCalls, pythonEngine.timelineCalls)
	}
}

func TestExtractTimelineWithEnginesAutoReturnsFallbackRequiredInGoOnlyRuntime(t *testing.T) {
	pythonEngine := &stubExtractorEngine{name: "python-gallery-dl"}
	goEngine := &stubExtractorEngine{
		name:              "go-twitter",
		timelineSupported: true,
		timelineError:     newEngineFallbackRequiredError("go-twitter", "payload shape changed", errors.New("unexpected instruction tree")),
	}

	response, err := extractTimelineWithEngines(context.Background(), TimelineRequest{Username: "example"}, ExtractorEngineModeAuto, pythonEngine, goEngine)
	if err == nil {
		t.Fatal("expected fallback-required error")
	}
	if response != nil {
		t.Fatalf("expected nil response, got %#v", response)
	}
	if !errors.Is(err, ErrEngineFallbackRequired) {
		t.Fatalf("expected fallback-required error, got %v", err)
	}
	if pythonEngine.timelineCalls != 0 || goEngine.timelineCalls != 1 {
		t.Fatalf("expected only go engine to run, got go=%d python=%d", goEngine.timelineCalls, pythonEngine.timelineCalls)
	}
}

func TestExtractTimelineWithEnginesAutoUsesGoForPrivateLikes(t *testing.T) {
	pythonEngine := &stubExtractorEngine{name: "python-gallery-dl"}
	goResponse := sampleTwitterResponse()
	goResponse.AccountInfo.Nick = "go-private-likes"
	goEngine := &stubExtractorEngine{
		name:              "go-twitter",
		timelineSupported: true,
		timelineResponse:  goResponse,
	}

	response, err := extractTimelineWithEngines(context.Background(), TimelineRequest{
		Username:     "example_user",
		TimelineType: "likes",
		MediaType:    "all",
	}, ExtractorEngineModeAuto, pythonEngine, goEngine)
	if err != nil {
		t.Fatalf("extractTimelineWithEngines returned error: %v", err)
	}
	if !reflect.DeepEqual(response, goResponse) {
		t.Fatalf("unexpected response: %#v", response)
	}
	if pythonEngine.timelineCalls != 0 || goEngine.timelineCalls != 1 {
		t.Fatalf("expected only go engine to run, got go=%d python=%d", goEngine.timelineCalls, pythonEngine.timelineCalls)
	}
}

func TestExtractTimelineWithEnginesAutoUsesGoForPrivateBookmarks(t *testing.T) {
	pythonEngine := &stubExtractorEngine{name: "python-gallery-dl"}
	goResponse := sampleTwitterResponse()
	goResponse.AccountInfo.Nick = "go-private-bookmarks"
	goEngine := &stubExtractorEngine{
		name:              "go-twitter",
		timelineSupported: true,
		timelineResponse:  goResponse,
	}

	response, err := extractTimelineWithEngines(context.Background(), TimelineRequest{
		Username:     "",
		TimelineType: "bookmarks",
		MediaType:    "all",
	}, ExtractorEngineModeAuto, pythonEngine, goEngine)
	if err != nil {
		t.Fatalf("extractTimelineWithEngines returned error: %v", err)
	}
	if !reflect.DeepEqual(response, goResponse) {
		t.Fatalf("unexpected response: %#v", response)
	}
	if pythonEngine.timelineCalls != 0 || goEngine.timelineCalls != 1 {
		t.Fatalf("expected only go engine to run, got go=%d python=%d", goEngine.timelineCalls, pythonEngine.timelineCalls)
	}
}

func TestExtractTimelineWithEnginesAutoReturnsGoBusinessError(t *testing.T) {
	pythonEngine := &stubExtractorEngine{
		name:              "python-gallery-dl",
		timelineSupported: true,
	}
	goEngine := &stubExtractorEngine{
		name:              "go-twitter",
		timelineSupported: true,
		timelineError:     errors.New("upstream api failure"),
	}

	response, err := extractTimelineWithEngines(context.Background(), TimelineRequest{Username: "example"}, ExtractorEngineModeAuto, pythonEngine, goEngine)
	if err == nil {
		t.Fatal("expected go business error")
	}
	if response != nil {
		t.Fatalf("expected nil response, got %#v", response)
	}
	if pythonEngine.timelineCalls != 0 {
		t.Fatalf("did not expect python fallback on business error, got %d calls", pythonEngine.timelineCalls)
	}
	if goEngine.timelineCalls != 1 {
		t.Fatalf("expected one go engine call, got %d", goEngine.timelineCalls)
	}
}

func TestExtractTimelineWithEnginesGoModeReturnsUnsupported(t *testing.T) {
	pythonEngine := &stubExtractorEngine{name: "python-gallery-dl"}
	goEngine := &stubExtractorEngine{
		name:              "go-twitter",
		timelineError:     newEngineUnsupportedError("go-twitter", "not implemented"),
		timelineSupported: false,
	}

	response, err := extractTimelineWithEngines(context.Background(), TimelineRequest{Username: "example"}, ExtractorEngineModeGo, pythonEngine, goEngine)
	if err == nil {
		t.Fatal("expected unsupported error")
	}
	if response != nil {
		t.Fatalf("expected nil response, got %#v", response)
	}
	if !errors.Is(err, ErrEngineUnsupported) {
		t.Fatalf("expected unsupported error, got %v", err)
	}
	if pythonEngine.timelineCalls != 0 || goEngine.timelineCalls != 1 {
		t.Fatalf("unexpected engine calls: python=%d go=%d", pythonEngine.timelineCalls, goEngine.timelineCalls)
	}
}

func TestPythonGalleryDLEngineReturnsUnavailableWhenFallbackMissing(t *testing.T) {
	resetPythonFallbackStatusForTests()
	setPythonFallbackStatusForTests(PythonFallbackStatus{
		Available:            false,
		BuildFlavor:          PythonFallbackBuildFlavorGoOnly,
		AdHocParityAvailable: false,
		UnavailableReason:    "python fallback unavailable in this go-only build",
	})
	defer resetPythonFallbackStatusForTests()

	engine := &PythonGalleryDLEngine{}
	_, err := engine.ExtractTimeline(context.Background(), TimelineRequest{Username: "example"})
	if err == nil {
		t.Fatal("expected python fallback unavailable error")
	}
	if !errors.Is(err, ErrPythonFallbackUnavailable) {
		t.Fatalf("expected python fallback unavailable error, got %v", err)
	}
}

func TestExtractTimelineWithEnginesPythonModeStillUsesGoInGoOnlyRuntime(t *testing.T) {
	resetPythonFallbackStatusForTests()
	setPythonFallbackStatusForTests(PythonFallbackStatus{
		Available:            false,
		BuildFlavor:          PythonFallbackBuildFlavorGoOnly,
		AdHocParityAvailable: false,
		UnavailableReason:    "python fallback unavailable in this go-only build",
	})
	defer resetPythonFallbackStatusForTests()

	goEngine := &stubExtractorEngine{
		name:              "go-twitter",
		timelineSupported: true,
		timelineResponse:  sampleTwitterResponse(),
	}

	response, err := extractTimelineWithEngines(context.Background(), TimelineRequest{Username: "example"}, ExtractorEngineModePython, newPythonGalleryDLEngine(), goEngine)
	if err != nil {
		t.Fatalf("expected python mode alias to continue with go-only runtime, got %v", err)
	}
	if response == nil {
		t.Fatal("expected go response")
	}
	if goEngine.timelineCalls != 1 {
		t.Fatalf("expected go engine to run once in python mode alias, got %d calls", goEngine.timelineCalls)
	}
}

func TestExtractDateRangeWithEnginesAutoReturnsUnsupportedInGoOnlyRuntime(t *testing.T) {
	pythonEngine := &stubExtractorEngine{name: "python-gallery-dl"}
	goEngine := &stubExtractorEngine{
		name:               "go-twitter",
		dateRangeSupported: true,
		dateRangeError:     newEngineUnsupportedError("go-twitter", "not yet supported"),
	}

	response, err := extractDateRangeWithEngines(
		context.Background(),
		DateRangeRequest{Username: "example", StartDate: "2025-01-01", EndDate: "2025-01-31"},
		ExtractorEngineModeAuto,
		pythonEngine,
		goEngine,
	)
	if err == nil {
		t.Fatal("expected unsupported error")
	}
	if response != nil {
		t.Fatalf("expected nil response, got %#v", response)
	}
	if !errors.Is(err, ErrEngineUnsupported) {
		t.Fatalf("expected unsupported error, got %v", err)
	}
	if pythonEngine.dateRangeCalls != 0 || goEngine.dateRangeCalls != 1 {
		t.Fatalf("expected only go engine to run, got go=%d python=%d", goEngine.dateRangeCalls, pythonEngine.dateRangeCalls)
	}
}

func TestCompareTwitterResponsesDetectsDifferences(t *testing.T) {
	pythonResponse := sampleTwitterResponse()
	goResponse := sampleTwitterResponse()
	goResponse.Timeline[0].URL = "https://cdn.example.com/other.jpg"

	differences := compareTwitterResponses(pythonResponse, goResponse, nil, nil)
	if len(differences) == 0 {
		t.Fatal("expected parity differences")
	}
}

func TestCompareTimelineExtractorParityReturnsRetiredWhenGoOnlyRuntimeIsCutOver(t *testing.T) {
	resetPythonFallbackStatusForTests()
	setPythonFallbackStatusForTests(PythonFallbackStatus{
		Available:            false,
		BuildFlavor:          PythonFallbackBuildFlavorGoOnly,
		AdHocParityAvailable: false,
		UnavailableReason:    "python fallback unavailable in this go-only build",
	})
	defer resetPythonFallbackStatusForTests()

	report, err := CompareTimelineExtractorParity(TimelineRequest{
		Username:     "nasa",
		TimelineType: "media",
		MediaType:    "all",
		AuthToken:    "public-token",
	})
	if err == nil {
		t.Fatal("expected parity unavailable error")
	}
	if report == nil {
		t.Fatal("expected parity report")
	}
	if report.PythonError == "" {
		t.Fatal("expected parity report to include python error")
	}
	if !errors.Is(err, ErrExtractorControlRetired) {
		t.Fatalf("expected retired control error, got %v", err)
	}
}

func sampleTwitterResponse() *TwitterResponse {
	return &TwitterResponse{
		AccountInfo: AccountInfo{
			Name:           "Example User",
			Nick:           "example",
			FollowersCount: 10,
			FriendsCount:   3,
			ProfileImage:   "https://pbs.twimg.com/profile_images/example.jpg",
			StatusesCount:  99,
		},
		TotalURLs: 1,
		Timeline: []TimelineEntry{
			{
				URL:           "https://cdn.example.com/photo.jpg",
				Date:          "2025-01-02 03:04:05",
				TweetID:       TweetIDString(1234567890),
				Type:          "photo",
				Extension:     "jpg",
				Width:         1200,
				Height:        800,
				Content:       "hello world",
				FavoriteCount: 42,
			},
		},
		Metadata: ExtractMetadata{
			NewEntries: 1,
			Page:       1,
			BatchSize:  50,
			HasMore:    false,
			Cursor:     "cursor-1",
			Completed:  true,
		},
		Cursor:    "cursor-1",
		Completed: true,
	}
}
