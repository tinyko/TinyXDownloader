package backend

import (
	"errors"
	"fmt"
	"strings"
)

var ErrExtractorControlRetired = errors.New("extractor control retired in go-only runtime")

func retiredExtractorControlError(operation string) error {
	operation = strings.TrimSpace(operation)
	if operation == "" {
		return ErrExtractorControlRetired
	}
	return fmt.Errorf("%s: %w", operation, ErrExtractorControlRetired)
}

func RetiredExtractorControlError(operation string) error {
	return retiredExtractorControlError(operation)
}

func retiredExtractorControlReason(operation string) string {
	operation = strings.TrimSpace(operation)
	if operation == "" {
		return "go-only runtime has retired live parity and rollout controls; review saved extractor evidence instead"
	}
	return fmt.Sprintf("%s is retired in go-only runtime; review saved extractor evidence instead", operation)
}
