import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useSettingsPanelState } from "@/hooks/workspace/useSettingsPanelState";
import type {
  DownloadIntegrityMode,
  DownloadIntegrityReport,
  DownloadIntegrityTaskStatus,
} from "@/types/settings";

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
  cancelDownloadIntegrityTask: vi.fn(async () => true),
  checkExifToolInstalled: vi.fn(async () => false),
  checkFFmpegInstalled: vi.fn(async () => false),
  downloadExifToolBinary: vi.fn(async () => {}),
  downloadFFmpegBinary: vi.fn(async () => {}),
  getDownloadIntegrityTaskStatus: vi.fn(async () => ({
    in_progress: true,
    cancelled: false,
    mode: "quick",
    phase: "running",
    scanned_files: 0,
    checked_files: 0,
    verified_files: 0,
    partial_files: 0,
    incomplete_files: 0,
    untracked_files: 0,
    unverifiable_files: 0,
    issues_count: 0,
    error: "",
    report: null,
  })),
  openSettingsFolder: vi.fn(async () => {}),
  selectDownloadFolder: vi.fn(async () => ""),
  startDownloadIntegrityTask: vi.fn(async () => ({
    in_progress: true,
    cancelled: false,
    mode: "quick",
    phase: "running",
    scanned_files: 0,
    checked_files: 0,
    verified_files: 0,
    partial_files: 0,
    incomplete_files: 0,
    untracked_files: 0,
    unverifiable_files: 0,
    issues_count: 0,
    error: "",
    report: null,
  })),
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
  cancelDownloadIntegrityTask: settingsClientMocks.cancelDownloadIntegrityTask,
  checkExifToolInstalled: settingsClientMocks.checkExifToolInstalled,
  checkFFmpegInstalled: settingsClientMocks.checkFFmpegInstalled,
  downloadExifToolBinary: settingsClientMocks.downloadExifToolBinary,
  downloadFFmpegBinary: settingsClientMocks.downloadFFmpegBinary,
  getDownloadIntegrityTaskStatus: settingsClientMocks.getDownloadIntegrityTaskStatus,
  openSettingsFolder: settingsClientMocks.openSettingsFolder,
  selectDownloadFolder: settingsClientMocks.selectDownloadFolder,
  startDownloadIntegrityTask: settingsClientMocks.startDownloadIntegrityTask,
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

function createIntegrityStatus(
  overrides: Partial<DownloadIntegrityTaskStatus> = {}
): DownloadIntegrityTaskStatus {
  return {
    in_progress: false,
    cancelled: false,
    mode: "quick",
    phase: "",
    scanned_files: 0,
    checked_files: 0,
    verified_files: 0,
    partial_files: 0,
    incomplete_files: 0,
    untracked_files: 0,
    unverifiable_files: 0,
    issues_count: 0,
    error: "",
    report: null,
    ...overrides,
  };
}

function createIntegrityReport(
  overrides: Partial<DownloadIntegrityReport> = {}
): DownloadIntegrityReport {
  return {
    mode: "quick",
    download_path: "/downloads",
    scanned_files: 12,
    checked_files: 12,
    complete_files: 12,
    partial_files: 0,
    incomplete_files: 0,
    untracked_files: 0,
    unverifiable_files: 0,
    issues: [],
    ...overrides,
  };
}

async function startIntegrityCheck(
  mode: DownloadIntegrityMode,
  hook: ReturnType<typeof renderHook<typeof useSettingsPanelState>>
) {
  await act(async () => {
    await hook.result.current.handleCheckIntegrity(mode);
  });
}

async function pollIntegrityStatus() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(500);
    await Promise.resolve();
  });
}

describe("useSettingsPanelState", () => {
  beforeEach(() => {
    settingsModuleMocks.resetState();
    settingsClientMocks.checkFFmpegInstalled.mockResolvedValue(false);
    settingsClientMocks.checkExifToolInstalled.mockResolvedValue(false);
    settingsClientMocks.startDownloadIntegrityTask.mockResolvedValue(
      createIntegrityStatus({
        in_progress: true,
        mode: "quick",
        phase: "starting",
      })
    );
    settingsClientMocks.getDownloadIntegrityTaskStatus.mockResolvedValue(
      createIntegrityStatus({
        in_progress: true,
        mode: "quick",
        phase: "running",
      })
    );
    settingsClientMocks.cancelDownloadIntegrityTask.mockResolvedValue(true);
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
    expect(result.current.ffmpegInstalled).toBe(true);
    expect(result.current.exiftoolInstalled).toBe(false);
  });

  it("shows an error when integrity check starts without a download path", async () => {
    settingsModuleMocks.setCurrentSettings(createSettings({ downloadPath: "" }));
    settingsModuleMocks.setSettingsWithDefaults(createSettings({ downloadPath: "" }));

    const hook = renderHook(() => useSettingsPanelState({}));

    await act(async () => {
      await hook.result.current.handleCheckIntegrity("quick");
    });

    expect(settingsClientMocks.startDownloadIntegrityTask).not.toHaveBeenCalled();
    expect(toastMocks.error).toHaveBeenCalledWith("Download path is empty");
  });

  it("starts an integrity task and stores the current status", async () => {
    settingsModuleMocks.setCurrentSettings(
      createSettings({
        downloadPath: "/downloads/active",
        proxy: "socks5://127.0.0.1:1080",
      })
    );
    settingsClientMocks.startDownloadIntegrityTask.mockResolvedValueOnce(
      createIntegrityStatus({
        in_progress: true,
        mode: "quick",
        phase: "scanning",
      })
    );

    const hook = renderHook(() => useSettingsPanelState({}));

    await startIntegrityCheck("quick", hook);

    expect(settingsClientMocks.startDownloadIntegrityTask).toHaveBeenCalledWith(
      "/downloads/active",
      "socks5://127.0.0.1:1080",
      "quick"
    );
    expect(hook.result.current.checkingIntegrity).toBe(true);
    expect(hook.result.current.checkingIntegrityMode).toBe("quick");
    expect(hook.result.current.integrityTaskStatus).toEqual(
      createIntegrityStatus({
        in_progress: true,
        mode: "quick",
        phase: "scanning",
      })
    );
  });

  it("completes polling with a clean report and shows a success toast", async () => {
    vi.useFakeTimers();
    settingsModuleMocks.setCurrentSettings(createSettings({ downloadPath: "/downloads/clean" }));
    const report = createIntegrityReport({
      mode: "quick",
      download_path: "/downloads/clean",
      checked_files: 12,
    });

    settingsClientMocks.startDownloadIntegrityTask.mockResolvedValueOnce(
      createIntegrityStatus({
        in_progress: true,
        mode: "quick",
        phase: "running",
      })
    );
    settingsClientMocks.getDownloadIntegrityTaskStatus.mockResolvedValueOnce(
      createIntegrityStatus({
        in_progress: false,
        mode: "quick",
        phase: "complete",
        report,
      })
    );

    const hook = renderHook(() => useSettingsPanelState({}));

    await startIntegrityCheck("quick", hook);
    await pollIntegrityStatus();

    expect(hook.result.current.checkingIntegrity).toBe(false);
    expect(hook.result.current.showIntegrityReport).toBe(true);
    expect(hook.result.current.integrityReport).toEqual(report);
    expect(toastMocks.success).toHaveBeenCalledWith(
      "Quick check completed: 12 tracked file(s), no incomplete files found"
    );
  });

  it("completes polling with issues and shows a warning toast", async () => {
    vi.useFakeTimers();
    settingsModuleMocks.setCurrentSettings(createSettings({ downloadPath: "/downloads/issues" }));
    const report = createIntegrityReport({
      mode: "deep",
      download_path: "/downloads/issues",
      partial_files: 1,
      incomplete_files: 2,
      checked_files: 9,
    });

    settingsClientMocks.startDownloadIntegrityTask.mockResolvedValueOnce(
      createIntegrityStatus({
        in_progress: true,
        mode: "deep",
        phase: "running",
      })
    );
    settingsClientMocks.getDownloadIntegrityTaskStatus.mockResolvedValueOnce(
      createIntegrityStatus({
        in_progress: false,
        mode: "deep",
        phase: "complete",
        report,
      })
    );

    const hook = renderHook(() => useSettingsPanelState({}));

    await startIntegrityCheck("deep", hook);
    await pollIntegrityStatus();

    expect(hook.result.current.checkingIntegrity).toBe(false);
    expect(toastMocks.warning).toHaveBeenCalledWith(
      "Deep check found 3 incomplete item(s)"
    );
  });

  it("handles a cancelled integrity task", async () => {
    vi.useFakeTimers();
    settingsModuleMocks.setCurrentSettings(createSettings({ downloadPath: "/downloads/cancelled" }));
    settingsClientMocks.getDownloadIntegrityTaskStatus.mockResolvedValueOnce(
      createIntegrityStatus({
        in_progress: false,
        cancelled: true,
        mode: "quick",
        phase: "cancelled",
      })
    );

    const hook = renderHook(() => useSettingsPanelState({}));

    await startIntegrityCheck("quick", hook);
    await pollIntegrityStatus();

    expect(hook.result.current.checkingIntegrity).toBe(false);
    expect(toastMocks.info).toHaveBeenCalledWith("Quick integrity check cancelled");
  });

  it("handles an integrity task status error returned by polling", async () => {
    vi.useFakeTimers();
    settingsModuleMocks.setCurrentSettings(createSettings({ downloadPath: "/downloads/error" }));
    settingsClientMocks.getDownloadIntegrityTaskStatus.mockResolvedValueOnce(
      createIntegrityStatus({
        in_progress: false,
        mode: "quick",
        phase: "failed",
        error: "backend failed",
      })
    );

    const hook = renderHook(() => useSettingsPanelState({}));

    await startIntegrityCheck("quick", hook);
    await pollIntegrityStatus();

    expect(hook.result.current.checkingIntegrity).toBe(false);
    expect(toastMocks.error).toHaveBeenCalledWith(
      "Integrity check failed: backend failed"
    );
  });

  it("handles polling promise rejections", async () => {
    vi.useFakeTimers();
    settingsModuleMocks.setCurrentSettings(createSettings({ downloadPath: "/downloads/rejected" }));
    settingsClientMocks.getDownloadIntegrityTaskStatus.mockRejectedValueOnce(
      new Error("poll failed")
    );

    const hook = renderHook(() => useSettingsPanelState({}));

    await startIntegrityCheck("quick", hook);
    await pollIntegrityStatus();

    expect(hook.result.current.checkingIntegrity).toBe(false);
    expect(toastMocks.error).toHaveBeenCalledWith(
      "Integrity check failed: poll failed"
    );
  });

  it("reports when there is no integrity task to cancel", async () => {
    settingsModuleMocks.setCurrentSettings(createSettings({ downloadPath: "/downloads/idle" }));
    settingsClientMocks.cancelDownloadIntegrityTask.mockResolvedValueOnce(false);

    const hook = renderHook(() => useSettingsPanelState({}));

    await act(async () => {
      await hook.result.current.handleCancelIntegrityCheck();
    });

    expect(toastMocks.info).toHaveBeenCalledWith(
      "No integrity check is currently running"
    );
  });

  it("reports cancel failures", async () => {
    settingsModuleMocks.setCurrentSettings(createSettings({ downloadPath: "/downloads/idle" }));
    settingsClientMocks.cancelDownloadIntegrityTask.mockRejectedValueOnce(
      new Error("cancel failed")
    );

    const hook = renderHook(() => useSettingsPanelState({}));

    await act(async () => {
      await hook.result.current.handleCancelIntegrityCheck();
    });

    expect(toastMocks.error).toHaveBeenCalledWith(
      "Could not cancel integrity check: cancel failed"
    );
  });
});
