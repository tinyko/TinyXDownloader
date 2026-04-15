package main

import (
	"fmt"
	"time"
)

func (a *App) runSmokeDownloadSession(totalItems int) (DownloadMediaResponse, error) {
	if totalItems <= 0 {
		totalItems = 6
	}

	if err := a.beginDownloadSession(totalItems); err != nil {
		return DownloadMediaResponse{Success: false, Message: err.Error()}, err
	}
	defer a.finishDownloadSession()

	ticker := time.NewTicker(250 * time.Millisecond)
	defer ticker.Stop()

	current := 0
	for current < totalItems {
		select {
		case <-a.downloadCtx.Done():
			return DownloadMediaResponse{
				Success:    true,
				Downloaded: current,
				Skipped:    totalItems - current,
				Failed:     0,
				Message:    "Download cancelled",
			}, nil
		case <-ticker.C:
			current += 1
			a.updateDownloadProgress(current, totalItems, (current*100)/totalItems)
		}
	}

	return DownloadMediaResponse{
		Success:    true,
		Downloaded: totalItems,
		Skipped:    0,
		Failed:     0,
		Message:    fmt.Sprintf("Downloaded %d files, 0 skipped, 0 failed", totalItems),
	}, nil
}
