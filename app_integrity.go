package main

import (
	"context"
	"fmt"
	"twitterxmediabatchdownloader/backend"
)

func (a *App) CheckDownloadIntegrity(req CheckDownloadIntegrityRequest) (backend.DownloadIntegrityReport, error) {
	return backend.CheckDownloadIntegrity(req.DownloadPath, req.Proxy, req.Mode)
}

func (a *App) StartDownloadIntegrityTask(req CheckDownloadIntegrityRequest) (DownloadIntegrityTaskStatusResponse, error) {
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
		InProgress: true,
		Mode:       mode,
		Phase:      "preparing-index",
	}

	go a.runIntegrityTask(ctx, req.DownloadPath, req.Proxy, mode)

	return a.integrityTask, nil
}

func (a *App) runIntegrityTask(ctx context.Context, downloadPath, proxy, mode string) {
	report, err := backend.CheckDownloadIntegrityWithContext(
		ctx,
		downloadPath,
		proxy,
		mode,
		func(progress backend.DownloadIntegrityProgress) {
			a.integrityMu.Lock()
			if ctx.Err() != nil || !a.integrityTask.InProgress {
				a.integrityMu.Unlock()
				return
			}
			a.integrityTask.Mode = progress.Mode
			a.integrityTask.Phase = progress.Phase
			a.integrityTask.ScannedFiles = progress.ScannedFiles
			a.integrityTask.CheckedFiles = progress.CheckedFiles
			a.integrityTask.VerifiedFiles = progress.VerifiedFiles
			a.integrityTask.PartialFiles = progress.PartialFiles
			a.integrityTask.IncompleteFiles = progress.IncompleteFiles
			a.integrityTask.UntrackedFiles = progress.UntrackedFiles
			a.integrityTask.UnverifiableFiles = progress.UnverifiableFiles
			a.integrityTask.IssuesCount = progress.IssuesCount
			a.integrityMu.Unlock()
		},
	)

	a.integrityMu.Lock()
	defer a.integrityMu.Unlock()

	if ctx.Err() != nil {
		a.integrityTask.InProgress = false
		a.integrityTask.Cancelled = true
		a.integrityTask.Phase = "completed"
		a.integrityTask.Error = ""
		a.integrityCtx = nil
		a.integrityCancel = nil
		return
	}

	a.integrityTask.InProgress = false
	a.integrityTask.Phase = "completed"
	a.integrityTask.Report = &report
	a.integrityTask.ScannedFiles = report.ScannedFiles
	a.integrityTask.CheckedFiles = report.CheckedFiles
	a.integrityTask.PartialFiles = report.PartialFiles
	a.integrityTask.IncompleteFiles = report.IncompleteFiles
	a.integrityTask.UntrackedFiles = report.UntrackedFiles
	a.integrityTask.UnverifiableFiles = report.UnverifiableFiles
	a.integrityTask.IssuesCount = len(report.Issues)
	a.integrityTask.integrateDeepVerifiedCount()
	if err != nil {
		a.integrityTask.Error = err.Error()
		a.integrityTask.Report = nil
	} else {
		a.integrityTask.Error = ""
	}
	a.integrityCtx = nil
	a.integrityCancel = nil
}

func (status *DownloadIntegrityTaskStatusResponse) integrateDeepVerifiedCount() {
	if status.Mode != "deep" {
		status.VerifiedFiles = 0
		return
	}
	status.VerifiedFiles = status.CheckedFiles - status.PartialFiles - status.UntrackedFiles - status.UnverifiableFiles
	if status.VerifiedFiles < 0 {
		status.VerifiedFiles = 0
	}
}

func (a *App) GetDownloadIntegrityTaskStatus() DownloadIntegrityTaskStatusResponse {
	a.integrityMu.Lock()
	defer a.integrityMu.Unlock()
	return a.integrityTask
}

func (a *App) CancelDownloadIntegrityTask() bool {
	a.integrityMu.Lock()
	cancel := a.integrityCancel
	a.integrityMu.Unlock()
	if cancel == nil {
		return false
	}
	cancel()
	return true
}
