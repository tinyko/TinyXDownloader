package backend

import (
	"context"
	"path/filepath"
	"runtime"
)

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

func getExecutableName() string {
	if runtime.GOOS == "windows" {
		return "extractor.exe"
	}
	return "extractor"
}

func getExtractorPath() string {
	return ResolveAppDataPath(getExecutableName())
}

func getHashFilePath() string {
	return ResolveAppDataPath(filepath.Base(getExecutableName()) + ".sha256")
}
