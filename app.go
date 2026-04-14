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
}

func NewApp() *App {
	return &App{}
}

func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
	backend.InitDB()
	backend.KillAllExtractorProcesses()
}

func (a *App) shutdown(ctx context.Context) {
	backend.CloseDB()
	backend.KillAllExtractorProcesses()
}

func (a *App) CleanupExtractorProcesses() {
	backend.KillAllExtractorProcesses()
}

func (a *App) CancelExtractorRequest(requestID string) bool {
	return backend.CancelExtractorRequest(requestID)
}

func (a *App) GetDefaults() map[string]string {
	return map[string]string{
		"downloadPath": backend.GetDefaultDownloadPath(),
	}
}

func (a *App) Quit() {
	panic("quit")
}
