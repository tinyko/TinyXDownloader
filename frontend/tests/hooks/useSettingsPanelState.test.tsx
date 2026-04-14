import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useSettingsPanelState } from "@/hooks/workspace/useSettingsPanelState";

const settingsModuleMocks = vi.hoisted(() => {
  const baseSettings = {
    downloadPath: "",
    theme: "yellow",
    themeMode: "auto",
    fontFamily: "google-sans",
    sfxEnabled: true,
    gifQuality: "fast",
    gifResolution: "original",
    proxy: "",
    fetchTimeout: 60,
    fetchMode: "batch",
    mediaType: "all",
    includeRetweets: false,
    rememberPublicToken: false,
    rememberPrivateToken: false,
  };
  let currentSettings = { ...baseSettings };
  let settingsWithDefaults = { ...baseSettings };

  return {
    baseSettings,
    getSettings: vi.fn(() => ({ ...currentSettings })),
    getSettingsWithDefaults: vi.fn(async () => ({ ...settingsWithDefaults })),
    saveSettings: vi.fn(),
    resetToDefaultSettings: vi.fn(async () => ({ ...settingsWithDefaults })),
    applyFont: vi.fn(),
    applyThemeMode: vi.fn(),
    setCurrentSettings(next: typeof baseSettings) {
      currentSettings = { ...next };
    },
    setSettingsWithDefaults(next: typeof baseSettings) {
      settingsWithDefaults = { ...next };
    },
    resetState() {
      currentSettings = { ...baseSettings };
      settingsWithDefaults = { ...baseSettings };
    },
  };
});

const settingsClientMocks = vi.hoisted(() => ({
  checkExifToolInstalled: vi.fn(async () => false),
  checkFFmpegInstalled: vi.fn(async () => false),
  downloadExifToolBinary: vi.fn(async () => {}),
  downloadFFmpegBinary: vi.fn(async () => {}),
  selectDownloadFolder: vi.fn(async () => ""),
}));

const themeMocks = vi.hoisted(() => ({
  applyTheme: vi.fn(),
}));

const toastMocks = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
  info: vi.fn(),
  message: vi.fn(),
}));

vi.mock("@/lib/settings", () => ({
  DEFAULT_SETTINGS: settingsModuleMocks.baseSettings,
  getSettings: settingsModuleMocks.getSettings,
  getSettingsWithDefaults: settingsModuleMocks.getSettingsWithDefaults,
  resetToDefaultSettings: settingsModuleMocks.resetToDefaultSettings,
  saveSettings: settingsModuleMocks.saveSettings,
  applyFont: settingsModuleMocks.applyFont,
  applyThemeMode: settingsModuleMocks.applyThemeMode,
}));

vi.mock("@/lib/settings-client", () => ({
  checkExifToolInstalled: settingsClientMocks.checkExifToolInstalled,
  checkFFmpegInstalled: settingsClientMocks.checkFFmpegInstalled,
  downloadExifToolBinary: settingsClientMocks.downloadExifToolBinary,
  downloadFFmpegBinary: settingsClientMocks.downloadFFmpegBinary,
  selectDownloadFolder: settingsClientMocks.selectDownloadFolder,
}));

vi.mock("@/lib/themes", () => ({
  applyTheme: themeMocks.applyTheme,
}));

vi.mock("@/lib/toast-with-sound", () => ({
  toastWithSound: toastMocks,
}));

function createSettings(
  overrides: Partial<typeof settingsModuleMocks.baseSettings> = {}
) {
  return {
    ...settingsModuleMocks.baseSettings,
    ...overrides,
  };
}

describe("useSettingsPanelState", () => {
  beforeEach(() => {
    settingsModuleMocks.resetState();
    settingsClientMocks.checkFFmpegInstalled.mockResolvedValue(false);
    settingsClientMocks.checkExifToolInstalled.mockResolvedValue(false);
    settingsClientMocks.downloadFFmpegBinary.mockResolvedValue(undefined);
    settingsClientMocks.downloadExifToolBinary.mockResolvedValue(undefined);
    settingsClientMocks.selectDownloadFolder.mockResolvedValue("");
  });

  it("loads default settings and tool availability on mount when download path is empty", async () => {
    settingsModuleMocks.setCurrentSettings(createSettings({ downloadPath: "" }));
    settingsModuleMocks.setSettingsWithDefaults(
      createSettings({ downloadPath: "/downloads/default" })
    );
    settingsClientMocks.checkFFmpegInstalled.mockResolvedValue(true);
    settingsClientMocks.checkExifToolInstalled.mockResolvedValue(false);

    const { result } = renderHook(() => useSettingsPanelState({}));

    await waitFor(() =>
      expect(result.current.tempSettings.downloadPath).toBe("/downloads/default")
    );
    await waitFor(() => expect(result.current.ffmpegInstalled).toBe(true));

    expect(settingsModuleMocks.getSettingsWithDefaults).toHaveBeenCalled();
    expect(settingsClientMocks.checkFFmpegInstalled).toHaveBeenCalled();
    expect(settingsClientMocks.checkExifToolInstalled).toHaveBeenCalled();
    expect(result.current.exiftoolInstalled).toBe(false);
  });

  it("saves current temp settings", async () => {
    settingsModuleMocks.setCurrentSettings(
      createSettings({ downloadPath: "/downloads/original" })
    );

    const { result } = renderHook(() => useSettingsPanelState({}));

    await waitFor(() =>
      expect(result.current.tempSettings.downloadPath).toBe("/downloads/original")
    );

    act(() => {
      result.current.setTempSettings((current) => ({
        ...current,
        downloadPath: "/downloads/updated",
        proxy: "http://127.0.0.1:7890",
      }));
    });

    await waitFor(() =>
      expect(result.current.tempSettings.downloadPath).toBe("/downloads/updated")
    );

    act(() => {
      result.current.handleSave();
    });

    expect(settingsModuleMocks.saveSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        downloadPath: "/downloads/updated",
        proxy: "http://127.0.0.1:7890",
      })
    );
    expect(toastMocks.success).toHaveBeenCalledWith("Settings saved");
  });

  it("resets settings to defaults and reapplies appearance", async () => {
    settingsModuleMocks.setCurrentSettings(
      createSettings({
        downloadPath: "/downloads/custom",
        theme: "red",
        themeMode: "dark",
        fontFamily: "system-ui",
      })
    );
    settingsModuleMocks.setSettingsWithDefaults(
      createSettings({
        downloadPath: "/downloads/default",
        theme: "emerald",
        themeMode: "light",
        fontFamily: "google-sans",
      })
    );
    settingsModuleMocks.resetToDefaultSettings.mockResolvedValueOnce(
      createSettings({
        downloadPath: "/downloads/default",
        theme: "emerald",
        themeMode: "light",
        fontFamily: "google-sans",
      })
    );

    const { result } = renderHook(() => useSettingsPanelState({}));

    await waitFor(() =>
      expect(result.current.tempSettings.downloadPath).toBe("/downloads/custom")
    );

    await act(async () => {
      await result.current.handleReset();
    });

    expect(result.current.tempSettings.downloadPath).toBe("/downloads/default");
    expect(settingsModuleMocks.resetToDefaultSettings).toHaveBeenCalled();
    expect(settingsModuleMocks.applyThemeMode).toHaveBeenCalledWith("light");
    expect(themeMocks.applyTheme).toHaveBeenCalledWith("emerald");
    expect(settingsModuleMocks.applyFont).toHaveBeenCalledWith("google-sans");
    expect(toastMocks.success).toHaveBeenCalledWith("Settings reset to default");
  });

  it("downloads FFmpeg and ExifTool binaries and updates installed flags", async () => {
    settingsModuleMocks.setCurrentSettings(
      createSettings({ downloadPath: "/downloads/tools" })
    );

    const { result } = renderHook(() => useSettingsPanelState({}));

    await waitFor(() => expect(result.current.ffmpegInstalled).toBe(false));

    await act(async () => {
      await result.current.handleDownloadFFmpeg();
      await result.current.handleDownloadExifTool();
    });

    expect(settingsClientMocks.downloadFFmpegBinary).toHaveBeenCalled();
    expect(settingsClientMocks.downloadExifToolBinary).toHaveBeenCalled();
    expect(result.current.ffmpegInstalled).toBe(true);
    expect(result.current.exiftoolInstalled).toBe(true);
  });
});
