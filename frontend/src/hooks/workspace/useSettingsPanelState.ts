import { useEffect, useState } from "react";

import {
  applyFont,
  applyThemeMode,
  getSettings,
  getSettingsWithDefaults,
  resetToDefaultSettings,
  saveSettings,
  type Settings as SettingsType,
} from "@/lib/settings";
import {
  checkExifToolInstalled,
  checkFFmpegInstalled,
  downloadExifToolBinary,
  downloadFFmpegBinary,
  selectDownloadFolder,
} from "@/lib/settings-client";
import { applyTheme } from "@/lib/themes";
import { toastWithSound as toast } from "@/lib/toast-with-sound";
import type {
  SettingsPanelProps,
} from "@/types/settings";

export function useSettingsPanelState({
  embedded = false,
  mode = "public",
  privateType = "bookmarks",
}: Pick<SettingsPanelProps, "embedded" | "mode" | "privateType">) {
  const [savedSettings, setSavedSettings] = useState<SettingsType>(getSettings());
  const [tempSettings, setTempSettings] = useState<SettingsType>(savedSettings);
  const [isDark, setIsDark] = useState(document.documentElement.classList.contains("dark"));
  const [ffmpegInstalled, setFfmpegInstalled] = useState(false);
  const [downloadingFFmpeg, setDownloadingFFmpeg] = useState(false);
  const [exiftoolInstalled, setExiftoolInstalled] = useState(false);
  const [downloadingExifTool, setDownloadingExifTool] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [showPublicToken, setShowPublicToken] = useState(false);
  const [showPrivateToken, setShowPrivateToken] = useState(false);

  const showFetchControls = embedded;
  const dateRangeAvailable = mode === "public";
  const currentContextLabel =
    mode === "private"
      ? privateType === "likes"
        ? "Private Likes"
        : "Private Bookmarks"
      : "Public Fetch";

  useEffect(() => {
    applyThemeMode(savedSettings.themeMode);
    applyTheme(savedSettings.theme);

    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const handleChange = () => {
      if (savedSettings.themeMode === "auto") {
        applyThemeMode("auto");
        applyTheme(savedSettings.theme);
      }
    };

    mediaQuery.addEventListener("change", handleChange);
    return () => mediaQuery.removeEventListener("change", handleChange);
  }, [savedSettings.theme, savedSettings.themeMode]);

  useEffect(() => {
    applyThemeMode(tempSettings.themeMode);
    applyTheme(tempSettings.theme);
    applyFont(tempSettings.fontFamily);
    setTimeout(() => {
      setIsDark(document.documentElement.classList.contains("dark"));
    }, 0);
  }, [tempSettings.fontFamily, tempSettings.theme, tempSettings.themeMode]);

  useEffect(() => {
    let active = true;

    const loadDefaults = async () => {
      if (!savedSettings.downloadPath) {
        const settingsWithDefaults = await getSettingsWithDefaults();
        if (!active) {
          return;
        }
        setSavedSettings(settingsWithDefaults);
        setTempSettings(settingsWithDefaults);
      }

      const [ffmpeg, exiftool] = await Promise.all([
        checkFFmpegInstalled(),
        checkExifToolInstalled(),
      ]);
      if (!active) {
        return;
      }
      setFfmpegInstalled(ffmpeg);
      setExiftoolInstalled(exiftool);
    };

    void loadDefaults();
    return () => {
      active = false;
    };
  }, [savedSettings.downloadPath]);

  const handleSave = () => {
    saveSettings(tempSettings);
    setSavedSettings(tempSettings);
    toast.success("Settings saved");
  };

  const handleReset = async () => {
    const defaultSettings = await resetToDefaultSettings();
    setTempSettings(defaultSettings);
    setSavedSettings(defaultSettings);
    applyThemeMode(defaultSettings.themeMode);
    applyTheme(defaultSettings.theme);
    applyFont(defaultSettings.fontFamily);
    setShowResetConfirm(false);
    toast.success("Settings reset to default");
  };

  const handleBrowseFolder = async () => {
    try {
      const selectedPath = await selectDownloadFolder(tempSettings.downloadPath || "");
      if (selectedPath?.trim()) {
        setTempSettings((current) => ({ ...current, downloadPath: selectedPath }));
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      toast.error(`Error selecting folder: ${message}`);
    }
  };

  const handleDownloadFFmpeg = async () => {
    setDownloadingFFmpeg(true);
    try {
      await downloadFFmpegBinary();
      setFfmpegInstalled(true);
      toast.success("FFmpeg downloaded successfully");
    } catch (error) {
      console.error("Error downloading FFmpeg:", error);
      toast.error("Failed to download FFmpeg");
    } finally {
      setDownloadingFFmpeg(false);
    }
  };

  const handleDownloadExifTool = async () => {
    setDownloadingExifTool(true);
    try {
      await downloadExifToolBinary();
      setExiftoolInstalled(true);
      toast.success("ExifTool downloaded successfully");
    } catch (error) {
      console.error("Error downloading ExifTool:", error);
      toast.error("Failed to download ExifTool");
    } finally {
      setDownloadingExifTool(false);
    }
  };

  return {
    savedSettings,
    tempSettings,
    setTempSettings,
    isDark,
    ffmpegInstalled,
    downloadingFFmpeg,
    exiftoolInstalled,
    downloadingExifTool,
    showResetConfirm,
    setShowResetConfirm,
    showPublicToken,
    setShowPublicToken,
    showPrivateToken,
    setShowPrivateToken,
    showFetchControls,
    dateRangeAvailable,
    currentContextLabel,
    handleSave,
    handleReset,
    handleBrowseFolder,
    handleDownloadFFmpeg,
    handleDownloadExifTool,
  };
}
