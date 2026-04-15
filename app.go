package main

import (
	"context"
	"embed"
	"encoding/json"
	"sync"
	"twitterxmediabatchdownloader/backend"
	"twitterxmediabatchdownloader/internal/desktop/smoke"
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

	smoke *smoke.Harness
}

func NewApp() *App {
	return &App{}
}

func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
	backend.InitDB()
	backend.KillAllExtractorProcesses()
	if backend.IsSmokeMode() {
		a.smoke = smoke.NewHarness()
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
		return a.smoke.CancelRequest(requestID)
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

//go:embed wails.json
var appConfigFS embed.FS

type embeddedAppConfig struct {
	Name string `json:"name"`
	Info struct {
		ProductName    string `json:"productName"`
		ProductVersion string `json:"productVersion"`
	} `json:"info"`
}

var (
	embeddedAppConfigOnce sync.Once
	embeddedAppConfigData embeddedAppConfig
)

func loadEmbeddedAppConfig() embeddedAppConfig {
	embeddedAppConfigOnce.Do(func() {
		data, err := appConfigFS.ReadFile("wails.json")
		if err != nil {
			return
		}
		_ = json.Unmarshal(data, &embeddedAppConfigData)
	})
	return embeddedAppConfigData
}

func AppName() string {
	config := loadEmbeddedAppConfig()
	if config.Info.ProductName != "" {
		return config.Info.ProductName
	}
	if config.Name != "" {
		return config.Name
	}
	return "TinyXDownloader"
}

func AppVersion() string {
	config := loadEmbeddedAppConfig()
	if config.Info.ProductVersion != "" {
		return config.Info.ProductVersion
	}
	return "dev"
}
