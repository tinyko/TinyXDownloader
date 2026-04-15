package main

import (
	"context"
	"sync"
	"twitterxmediabatchdownloader/backend"
)

type App struct {
	ctx            context.Context
	downloadCtx    context.Context
	downloadCancel context.CancelFunc
	downloadMu     sync.Mutex
	downloadState  DownloadStateResponse

	integrityCtx    context.Context
	integrityCancel context.CancelFunc
	integrityMu     sync.Mutex
	integrityTask   DownloadIntegrityTaskStatusResponse

	smoke *smokeHarness
}

func NewApp() *App {
	return &App{}
}

func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
	backend.InitDB()
	backend.KillAllExtractorProcesses()
	if backend.IsSmokeMode() {
		a.smoke = newSmokeHarness()
	}
	_ = backend.AppendBackendDiagnosticLog("info", "application startup completed")
}

func (a *App) shutdown(ctx context.Context) {
	_ = backend.AppendBackendDiagnosticLog("info", "application shutdown requested")
	backend.CloseDB()
	backend.KillAllExtractorProcesses()
}

func (a *App) CleanupExtractorProcesses() {
	if a.smoke != nil {
		return
	}
	backend.KillAllExtractorProcesses()
}

func (a *App) CancelExtractorRequest(requestID string) bool {
	if a.smoke != nil {
		return a.smoke.cancelRequest(requestID)
	}
	return backend.CancelExtractorRequest(requestID)
}

func (a *App) GetDefaults() map[string]string {
	return map[string]string{
		"downloadPath":    backend.GetDefaultDownloadPath(),
		"appDataDir":      backend.GetAppDataDir(),
		"smokeMode":       map[bool]string{true: "1", false: ""}[backend.IsSmokeMode()],
		"smokeReportPath": backend.GetSmokeReportPath(),
	}
}

func (a *App) Quit() {
	panic("quit")
}
