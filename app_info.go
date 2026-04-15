package main

import (
	"embed"
	"encoding/json"
	"sync"
)

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
