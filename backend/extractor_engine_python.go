package backend

import (
	"context"
)

type PythonGalleryDLEngine struct{}

func (e *PythonGalleryDLEngine) Name() string {
	return "python-gallery-dl"
}

func (e *PythonGalleryDLEngine) ExtractTimeline(ctx context.Context, req TimelineRequest) (*TwitterResponse, error) {
	if err := contextError(ctx); err != nil {
		return nil, err
	}

	exePath, err := ensureExtractor()
	if err != nil {
		return nil, err
	}
	if err := contextError(ctx); err != nil {
		return nil, err
	}

	spec := buildTimelineExtractorSpec(req)
	cliResponse, err := executeExtractorSpec(exePath, req.RequestID, spec)
	if err != nil {
		return nil, err
	}
	if err := contextError(ctx); err != nil {
		return nil, err
	}

	return buildTimelineResponseFromCLIResponse(req, spec, cliResponse), nil
}

func (e *PythonGalleryDLEngine) ExtractDateRange(ctx context.Context, req DateRangeRequest) (*TwitterResponse, error) {
	if err := contextError(ctx); err != nil {
		return nil, err
	}

	exePath, err := ensureExtractor()
	if err != nil {
		return nil, err
	}
	if err := contextError(ctx); err != nil {
		return nil, err
	}

	spec := buildDateRangeExtractorSpec(req)
	cliResponse, err := executeExtractorSpec(exePath, req.RequestID, spec)
	if err != nil {
		return nil, err
	}
	if err := contextError(ctx); err != nil {
		return nil, err
	}

	return buildDateRangeResponseFromCLIResponse(req, spec, cliResponse), nil
}

func contextError(ctx context.Context) error {
	if ctx == nil {
		return nil
	}
	select {
	case <-ctx.Done():
		return ctx.Err()
	default:
		return nil
	}
}
