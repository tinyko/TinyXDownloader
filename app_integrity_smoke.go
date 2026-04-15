package main

import (
	"context"
	"fmt"
	"time"
	"twitterxmediabatchdownloader/backend"
)

func (a *App) checkSmokeDownloadIntegrity(req CheckDownloadIntegrityRequest) (backend.DownloadIntegrityReport, error) {
	mode := backend.NormalizeDownloadIntegrityModeForApp(req.Mode)
	return backend.DownloadIntegrityReport{
		Mode:              mode,
		DownloadPath:      req.DownloadPath,
		ScannedFiles:      24,
		CheckedFiles:      18,
		CompleteFiles:     18,
		PartialFiles:      0,
		IncompleteFiles:   0,
		UntrackedFiles:    0,
		UnverifiableFiles: 0,
		Issues:            []backend.DownloadIntegrityIssue{},
	}, nil
}

func (a *App) startSmokeIntegrityTask(req CheckDownloadIntegrityRequest) (DownloadIntegrityTaskStatusResponse, error) {
	mode := backend.NormalizeDownloadIntegrityModeForApp(req.Mode)

	a.integrityMu.Lock()
	defer a.integrityMu.Unlock()

	if a.integrityTask.InProgress {
		return a.integrityTask, fmt.Errorf("integrity check already in progress")
	}

	ctx, cancel := context.WithCancel(context.Background())
	a.integrityCtx = ctx
	a.integrityCancel = cancel
	a.integrityTask = DownloadIntegrityTaskStatusResponse{
		Status:     integrityTaskStatusRunning,
		InProgress: true,
		Cancelled:  false,
		Mode:       mode,
		Phase:      "preparing-index",
	}

	go a.runSmokeIntegrityTask(ctx, req.DownloadPath, mode)

	return a.integrityTask, nil
}

func (a *App) runSmokeIntegrityTask(ctx context.Context, downloadPath, mode string) {
	progressPhases := []struct {
		phase   string
		scanned int
		checked int
	}{
		{phase: "preparing-index", scanned: 3, checked: 0},
		{phase: "checking-files", scanned: 12, checked: 8},
		{phase: "finalizing-report", scanned: 24, checked: 18},
	}

	for _, step := range progressPhases {
		select {
		case <-ctx.Done():
			a.finishSmokeIntegrityTaskCancelled()
			return
		case <-time.After(450 * time.Millisecond):
			a.integrityMu.Lock()
			if !a.integrityTask.InProgress {
				a.integrityMu.Unlock()
				return
			}
			a.integrityTask.Phase = step.phase
			a.integrityTask.ScannedFiles = step.scanned
			a.integrityTask.CheckedFiles = step.checked
			a.integrityTask.VerifiedFiles = max(step.checked-1, 0)
			a.integrityMu.Unlock()
		}
	}

	if mode == "deep" {
		for i := 0; i < 6; i += 1 {
			select {
			case <-ctx.Done():
				a.finishSmokeIntegrityTaskCancelled()
				return
			case <-time.After(400 * time.Millisecond):
				a.integrityMu.Lock()
				if !a.integrityTask.InProgress {
					a.integrityMu.Unlock()
					return
				}
				a.integrityTask.Phase = "verifying-remote"
				a.integrityTask.ScannedFiles = 24
				a.integrityTask.CheckedFiles = 24
				a.integrityTask.VerifiedFiles = 22
				a.integrityMu.Unlock()
			}
		}
	}

	a.integrityMu.Lock()
	defer a.integrityMu.Unlock()

	if ctx.Err() != nil {
		a.integrityTask.Status = integrityTaskStatusCancelled
		a.integrityTask.InProgress = false
		a.integrityTask.Cancelled = true
		a.integrityTask.Phase = "cancelled"
		a.integrityTask.Report = nil
		a.integrityTask.Error = ""
		a.integrityCtx = nil
		a.integrityCancel = nil
		return
	}

	report := backend.DownloadIntegrityReport{
		Mode:              mode,
		DownloadPath:      downloadPath,
		ScannedFiles:      24,
		CheckedFiles:      24,
		CompleteFiles:     24,
		PartialFiles:      0,
		IncompleteFiles:   0,
		UntrackedFiles:    0,
		UnverifiableFiles: 0,
		Issues:            []backend.DownloadIntegrityIssue{},
	}

	a.integrityTask.Status = integrityTaskStatusCompleted
	a.integrityTask.InProgress = false
	a.integrityTask.Cancelled = false
	a.integrityTask.Phase = "completed"
	a.integrityTask.Report = &report
	a.integrityTask.Error = ""
	a.integrityTask.ScannedFiles = report.ScannedFiles
	a.integrityTask.CheckedFiles = report.CheckedFiles
	a.integrityTask.VerifiedFiles = report.CheckedFiles
	a.integrityTask.PartialFiles = report.PartialFiles
	a.integrityTask.IncompleteFiles = report.IncompleteFiles
	a.integrityTask.UntrackedFiles = report.UntrackedFiles
	a.integrityTask.UnverifiableFiles = report.UnverifiableFiles
	a.integrityTask.IssuesCount = len(report.Issues)
	a.integrityCtx = nil
	a.integrityCancel = nil
}

func (a *App) finishSmokeIntegrityTaskCancelled() {
	a.integrityMu.Lock()
	defer a.integrityMu.Unlock()

	a.integrityTask.Status = integrityTaskStatusCancelled
	a.integrityTask.InProgress = false
	a.integrityTask.Cancelled = true
	a.integrityTask.Phase = "cancelled"
	a.integrityTask.Report = nil
	a.integrityTask.Error = ""
	a.integrityCtx = nil
	a.integrityCancel = nil
}
