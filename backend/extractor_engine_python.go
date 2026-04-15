package backend

import "context"

type PythonGalleryDLEngine struct{}

func (e *PythonGalleryDLEngine) Name() string {
	return "python-gallery-dl"
}

func (e *PythonGalleryDLEngine) ExtractTimeline(ctx context.Context, req TimelineRequest) (*TwitterResponse, error) {
	if err := contextError(ctx); err != nil {
		return nil, err
	}
	return nil, retiredExtractorControlError("python extractor timeline")
}

func (e *PythonGalleryDLEngine) ExtractDateRange(ctx context.Context, req DateRangeRequest) (*TwitterResponse, error) {
	if err := contextError(ctx); err != nil {
		return nil, err
	}
	return nil, retiredExtractorControlError("python extractor date-range")
}
