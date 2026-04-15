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

func TestParseExtractorEngineModeDefaultsToPython(t *testing.T) {
	t.Run("empty", func(t *testing.T) {
		if got := parseExtractorEngineMode(""); got != ExtractorEngineModePython {
			t.Fatalf("expected python mode, got %q", got)
		}
	})

	t.Run("invalid", func(t *testing.T) {
		if got := parseExtractorEngineMode("invalid"); got != ExtractorEngineModePython {
			t.Fatalf("expected python mode, got %q", got)
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

func TestExtractTimelineWithEnginesAutoBypassesGoWhenUnsupported(t *testing.T) {
	pythonResponse := sampleTwitterResponse()
	pythonEngine := &stubExtractorEngine{
		name:              "python-gallery-dl",
		timelineSupported: true,
		timelineResponse:  pythonResponse,
	}
	goEngine := &stubExtractorEngine{
		name:              "go-twitter",
		timelineSupported: false,
		timelineReason:    "not yet supported",
	}

	response, err := extractTimelineWithEngines(context.Background(), TimelineRequest{Username: "example"}, ExtractorEngineModeAuto, pythonEngine, goEngine)
	if err != nil {
		t.Fatalf("extractTimelineWithEngines returned error: %v", err)
	}
	if !reflect.DeepEqual(response, pythonResponse) {
		t.Fatalf("unexpected response: %#v", response)
	}
	if pythonEngine.timelineCalls != 1 {
		t.Fatalf("expected python engine to run once, got %d", pythonEngine.timelineCalls)
	}
	if goEngine.timelineCalls != 0 {
		t.Fatalf("expected go engine to be bypassed, got %d calls", goEngine.timelineCalls)
	}
}

func TestExtractTimelineWithEnginesAutoFallsBackOnFallbackRequired(t *testing.T) {
	pythonResponse := sampleTwitterResponse()
	pythonEngine := &stubExtractorEngine{
		name:              "python-gallery-dl",
		timelineSupported: true,
		timelineResponse:  pythonResponse,
	}
	goEngine := &stubExtractorEngine{
		name:              "go-twitter",
		timelineSupported: true,
		timelineError:     newEngineFallbackRequiredError("go-twitter", "payload shape changed", errors.New("unexpected instruction tree")),
	}

	response, err := extractTimelineWithEngines(context.Background(), TimelineRequest{Username: "example"}, ExtractorEngineModeAuto, pythonEngine, goEngine)
	if err != nil {
		t.Fatalf("extractTimelineWithEngines returned error: %v", err)
	}
	if !reflect.DeepEqual(response, pythonResponse) {
		t.Fatalf("unexpected response: %#v", response)
	}
	if pythonEngine.timelineCalls != 1 || goEngine.timelineCalls != 1 {
		t.Fatalf("expected one go attempt and one python fallback, got go=%d python=%d", goEngine.timelineCalls, pythonEngine.timelineCalls)
	}
}

func TestExtractTimelineWithEnginesAutoPinsPrivateLikesToPython(t *testing.T) {
	pythonResponse := sampleTwitterResponse()
	pythonEngine := &stubExtractorEngine{
		name:              "python-gallery-dl",
		timelineSupported: true,
		timelineResponse:  pythonResponse,
	}
	goEngine := &stubExtractorEngine{
		name:              "go-twitter",
		timelineSupported: true,
		timelineResponse:  sampleTwitterResponse(),
	}

	response, err := extractTimelineWithEngines(context.Background(), TimelineRequest{
		Username:     "example_user",
		TimelineType: "likes",
		MediaType:    "all",
	}, ExtractorEngineModeAuto, pythonEngine, goEngine)
	if err != nil {
		t.Fatalf("extractTimelineWithEngines returned error: %v", err)
	}
	if !reflect.DeepEqual(response, pythonResponse) {
		t.Fatalf("unexpected response: %#v", response)
	}
	if pythonEngine.timelineCalls != 1 {
		t.Fatalf("expected python engine to run once, got %d", pythonEngine.timelineCalls)
	}
	if goEngine.timelineCalls != 0 {
		t.Fatalf("expected go engine to be bypassed in auto mode, got %d calls", goEngine.timelineCalls)
	}
}

func TestExtractTimelineWithEnginesAutoPinsPrivateBookmarksToPython(t *testing.T) {
	pythonResponse := sampleTwitterResponse()
	pythonEngine := &stubExtractorEngine{
		name:              "python-gallery-dl",
		timelineSupported: true,
		timelineResponse:  pythonResponse,
	}
	goEngine := &stubExtractorEngine{
		name:              "go-twitter",
		timelineSupported: true,
		timelineResponse:  sampleTwitterResponse(),
	}

	response, err := extractTimelineWithEngines(context.Background(), TimelineRequest{
		Username:     "",
		TimelineType: "bookmarks",
		MediaType:    "all",
	}, ExtractorEngineModeAuto, pythonEngine, goEngine)
	if err != nil {
		t.Fatalf("extractTimelineWithEngines returned error: %v", err)
	}
	if !reflect.DeepEqual(response, pythonResponse) {
		t.Fatalf("unexpected response: %#v", response)
	}
	if pythonEngine.timelineCalls != 1 {
		t.Fatalf("expected python engine to run once, got %d", pythonEngine.timelineCalls)
	}
	if goEngine.timelineCalls != 0 {
		t.Fatalf("expected go engine to be bypassed in auto mode, got %d calls", goEngine.timelineCalls)
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

func TestExtractDateRangeWithEnginesAutoBypassesGoWhenUnsupported(t *testing.T) {
	pythonResponse := sampleTwitterResponse()
	pythonEngine := &stubExtractorEngine{
		name:               "python-gallery-dl",
		dateRangeSupported: true,
		dateRangeResponse:  pythonResponse,
	}
	goEngine := &stubExtractorEngine{
		name:               "go-twitter",
		dateRangeSupported: false,
		dateRangeReason:    "not yet supported",
	}

	response, err := extractDateRangeWithEngines(
		context.Background(),
		DateRangeRequest{Username: "example", StartDate: "2025-01-01", EndDate: "2025-01-31"},
		ExtractorEngineModeAuto,
		pythonEngine,
		goEngine,
	)
	if err != nil {
		t.Fatalf("extractDateRangeWithEngines returned error: %v", err)
	}
	if !reflect.DeepEqual(response, pythonResponse) {
		t.Fatalf("unexpected response: %#v", response)
	}
	if pythonEngine.dateRangeCalls != 1 {
		t.Fatalf("expected python engine to run once, got %d", pythonEngine.dateRangeCalls)
	}
	if goEngine.dateRangeCalls != 0 {
		t.Fatalf("expected go engine to be bypassed, got %d calls", goEngine.dateRangeCalls)
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
