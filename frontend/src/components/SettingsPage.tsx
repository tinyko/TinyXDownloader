import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { InputWithContext } from "@/components/ui/input-with-context";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { FolderOpen, Save, RotateCcw, Info, Download, Check, FileCheck, Eye, EyeOff, Globe, KeyRound, Lock } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { getSettings, getSettingsWithDefaults, saveSettings, resetToDefaultSettings, applyThemeMode, applyFont, FONT_OPTIONS, type Settings as SettingsType, type FontFamily, type GifQuality, type GifResolution } from "@/lib/settings";
import { themes, applyTheme } from "@/lib/themes";
import { SelectFolder, IsFFmpegInstalled, DownloadFFmpeg, IsExifToolInstalled, DownloadExifTool, CheckDownloadIntegrity, OpenFolder } from "../../wailsjs/go/main/App";
import { toastWithSound as toast } from "@/lib/toast-with-sound";
import type { FetchMode, PrivateType } from "@/components/SearchBar";

interface DownloadIntegrityIssue {
  path: string;
  relative_path: string;
  reason: string;
  local_size: number;
  remote_size: number;
  url?: string;
}

interface DownloadIntegrityReport {
  download_path: string;
  scanned_files: number;
  checked_files: number;
  complete_files: number;
  partial_files: number;
  incomplete_files: number;
  untracked_files: number;
  unverifiable_files: number;
  issues: DownloadIntegrityIssue[];
}

function formatBytes(bytes: number): string {
  if (bytes <= 0) {
    return "0 B";
  }

  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex++;
  }

  return `${value.toFixed(value >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

function formatIntegrityReason(reason: string): string {
  switch (reason) {
    case "partial_file":
      return "Leftover partial file";
    case "size_mismatch":
      return "Local file is smaller than remote file";
    case "empty_text_file":
      return "Text export is empty";
    case "empty_file":
      return "Downloaded file is empty";
    default:
      return reason.replace(/_/g, " ");
  }
}

interface SettingsPageProps {
  embedded?: boolean;
  mode?: FetchMode;
  privateType?: PrivateType;
  publicAuthToken?: string;
  privateAuthToken?: string;
  onPublicAuthTokenChange?: (value: string) => void;
  onPrivateAuthTokenChange?: (value: string) => void;
  rememberPublicToken?: boolean;
  rememberPrivateToken?: boolean;
  onRememberPublicTokenChange?: (value: boolean) => void;
  onRememberPrivateTokenChange?: (value: boolean) => void;
  useDateRange?: boolean;
  startDate?: string;
  endDate?: string;
  onUseDateRangeChange?: (value: boolean) => void;
  onStartDateChange?: (value: string) => void;
  onEndDateChange?: (value: string) => void;
}

export function SettingsPage({
  embedded = false,
  mode = "public",
  privateType = "bookmarks",
  publicAuthToken = "",
  privateAuthToken = "",
  onPublicAuthTokenChange,
  onPrivateAuthTokenChange,
  rememberPublicToken = false,
  rememberPrivateToken = false,
  onRememberPublicTokenChange,
  onRememberPrivateTokenChange,
  useDateRange = false,
  startDate = "",
  endDate = "",
  onUseDateRangeChange,
  onStartDateChange,
  onEndDateChange,
}: SettingsPageProps) {
  const [savedSettings, setSavedSettings] = useState<SettingsType>(getSettings());
  const [tempSettings, setTempSettings] = useState<SettingsType>(savedSettings);
  const [isDark, setIsDark] = useState(document.documentElement.classList.contains('dark'));
  const [ffmpegInstalled, setFfmpegInstalled] = useState(false);
  const [downloadingFFmpeg, setDownloadingFFmpeg] = useState(false);
  const [exiftoolInstalled, setExiftoolInstalled] = useState(false);
  const [downloadingExifTool, setDownloadingExifTool] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [checkingIntegrity, setCheckingIntegrity] = useState(false);
  const [integrityReport, setIntegrityReport] = useState<DownloadIntegrityReport | null>(null);
  const [showIntegrityReport, setShowIntegrityReport] = useState(false);
  const [showPublicToken, setShowPublicToken] = useState(false);
  const [showPrivateToken, setShowPrivateToken] = useState(false);

  const showFetchControls =
    embedded &&
    typeof onPublicAuthTokenChange === "function" &&
    typeof onPrivateAuthTokenChange === "function";
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
  }, [savedSettings.themeMode, savedSettings.theme]);

  useEffect(() => {
    applyThemeMode(tempSettings.themeMode);
    applyTheme(tempSettings.theme);
    applyFont(tempSettings.fontFamily);
    setTimeout(() => {
      setIsDark(document.documentElement.classList.contains('dark'));
    }, 0);
  }, [tempSettings.themeMode, tempSettings.theme, tempSettings.fontFamily]);

  useEffect(() => {
    const loadDefaults = async () => {
      if (!savedSettings.downloadPath) {
        const settingsWithDefaults = await getSettingsWithDefaults();
        setSavedSettings(settingsWithDefaults);
        setTempSettings(settingsWithDefaults);
      }
    };
    loadDefaults();

    // Check FFmpeg and ExifTool status
    IsFFmpegInstalled().then(setFfmpegInstalled);
    IsExifToolInstalled().then(setExiftoolInstalled);
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
      const selectedPath = await SelectFolder(tempSettings.downloadPath || "");
      if (selectedPath && selectedPath.trim() !== "") {
        setTempSettings((prev) => ({ ...prev, downloadPath: selectedPath }));
      }
    } catch (error) {
      console.error("Error selecting folder:", error);
      toast.error(`Error selecting folder: ${error}`);
    }
  };

  const handleDownloadFFmpeg = async () => {
    setDownloadingFFmpeg(true);
    try {
      await DownloadFFmpeg();
      setFfmpegInstalled(true);
      toast.success("FFmpeg downloaded successfully");
    } catch (error) {
      toast.error("Failed to download FFmpeg");
      console.error("Error downloading FFmpeg:", error);
    } finally {
      setDownloadingFFmpeg(false);
    }
  };

  const handleDownloadExifTool = async () => {
    setDownloadingExifTool(true);
    try {
      await DownloadExifTool();
      setExiftoolInstalled(true);
      toast.success("ExifTool downloaded successfully");
    } catch (error) {
      toast.error("Failed to download ExifTool");
      console.error("Error downloading ExifTool:", error);
    } finally {
      setDownloadingExifTool(false);
    }
  };

  const handleCheckIntegrity = async () => {
    const downloadPath = (tempSettings.downloadPath || savedSettings.downloadPath || "").trim();
    if (!downloadPath) {
      toast.error("Download path is empty");
      return;
    }

    setCheckingIntegrity(true);
    try {
      const report = await CheckDownloadIntegrity({
        download_path: downloadPath,
        proxy: tempSettings.proxy || "",
      });
      setIntegrityReport(report);
      setShowIntegrityReport(true);

      const issueCount = report.partial_files + report.incomplete_files;
      if (issueCount > 0) {
        toast.warning(`Found ${issueCount} incomplete item(s)`);
      } else {
        toast.success(`Checked ${report.checked_files} tracked file(s), no incomplete files found`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      toast.error(`Integrity check failed: ${message}`);
    } finally {
      setCheckingIntegrity(false);
    }
  };

  const handleOpenIntegrityFolder = async () => {
    if (!integrityReport?.download_path) {
      return;
    }

    try {
      await OpenFolder(integrityReport.download_path);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      toast.error(`Could not open folder: ${message}`);
    }
  };

  return (
    <div className="space-y-6">
      {!embedded ? <h1 className="text-2xl font-bold">Settings</h1> : null}

      {showFetchControls ? (
        <section className="rounded-[24px] border border-border/70 bg-card/70 p-5 shadow-sm">
          <div className="mb-4 flex flex-col gap-1">
            <h2 className="text-sm font-semibold tracking-tight">Fetch Controls</h2>
            <p className="text-xs text-muted-foreground">
              Auth tokens and fetch defaults for the current workspace. Current context: {currentContextLabel}.
            </p>
          </div>

          <div className="grid gap-5 xl:grid-cols-2">
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="settings-public-auth" className="flex items-center gap-2">
                  <Globe className="h-4 w-4 text-muted-foreground" />
                  Public Auth Token
                </Label>
                <div className="relative">
                  <InputWithContext
                    id="settings-public-auth"
                    type={showPublicToken ? "text" : "password"}
                    placeholder="Enter public auth_token cookie value"
                    value={publicAuthToken}
                    onChange={(event) => onPublicAuthTokenChange?.(event.target.value)}
                    className="h-11 pr-10"
                    spellCheck={false}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className="absolute right-1 top-1/2 -translate-y-1/2"
                    onClick={() => setShowPublicToken((value) => !value)}
                    aria-label={showPublicToken ? "Hide public auth token" : "Show public auth token"}
                  >
                    {showPublicToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </Button>
                </div>
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="remember-public-token"
                    checked={rememberPublicToken}
                    onCheckedChange={(checked) => onRememberPublicTokenChange?.(Boolean(checked))}
                  />
                  <Label htmlFor="remember-public-token" className="cursor-pointer">
                    Remember public token on this device
                  </Label>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="settings-private-auth" className="flex items-center gap-2">
                  <Lock className="h-4 w-4 text-muted-foreground" />
                  Private Auth Token
                </Label>
                <div className="relative">
                  <InputWithContext
                    id="settings-private-auth"
                    type={showPrivateToken ? "text" : "password"}
                    placeholder="Enter private auth_token cookie value"
                    value={privateAuthToken}
                    onChange={(event) => onPrivateAuthTokenChange?.(event.target.value)}
                    className="h-11 pr-10"
                    spellCheck={false}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className="absolute right-1 top-1/2 -translate-y-1/2"
                    onClick={() => setShowPrivateToken((value) => !value)}
                    aria-label={showPrivateToken ? "Hide private auth token" : "Show private auth token"}
                  >
                    {showPrivateToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </Button>
                </div>
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="remember-private-token"
                    checked={rememberPrivateToken}
                    onCheckedChange={(checked) => onRememberPrivateTokenChange?.(Boolean(checked))}
                  />
                  <Label htmlFor="remember-private-token" className="cursor-pointer">
                    Remember private token on this device
                  </Label>
                </div>
                <p className="flex items-center gap-2 text-xs text-muted-foreground">
                  <KeyRound className="h-3.5 w-3.5" />
                  Public fetch uses the public token. Bookmarks and likes use the private token.
                </p>
              </div>
            </div>

            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="fetch-mode">Fetch Mode</Label>
                <Select
                  value={tempSettings.fetchMode}
                  onValueChange={(value: "single" | "batch") =>
                    setTempSettings((prev) => ({ ...prev, fetchMode: value }))
                  }
                >
                  <SelectTrigger id="fetch-mode" className="h-11 rounded-xl">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="batch">Batch</SelectItem>
                    <SelectItem value="single">Single</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="fetch-media-type">Media Type</Label>
                <Select
                  value={tempSettings.mediaType}
                  onValueChange={(value: SettingsType["mediaType"]) =>
                    setTempSettings((prev) => ({ ...prev, mediaType: value }))
                  }
                >
                  <SelectTrigger id="fetch-media-type" className="h-11 rounded-xl">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Media</SelectItem>
                    <SelectItem value="image">Images</SelectItem>
                    <SelectItem value="video">Videos</SelectItem>
                    <SelectItem value="gif">GIFs</SelectItem>
                    <SelectItem value="text">Text (No Media)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="flex items-center gap-2 rounded-xl bg-muted/50 p-3">
                <Checkbox
                  id="settings-retweets"
                  checked={tempSettings.includeRetweets}
                  onCheckedChange={(checked) =>
                    setTempSettings((prev) => ({
                      ...prev,
                      includeRetweets: Boolean(checked),
                    }))
                  }
                />
                <Label htmlFor="settings-retweets" className="cursor-pointer">
                  Include Retweets
                </Label>
              </div>

              <div className="space-y-3 rounded-2xl border border-border/70 bg-muted/20 p-3">
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="settings-date-range"
                    checked={dateRangeAvailable ? useDateRange : false}
                    disabled={!dateRangeAvailable}
                    onCheckedChange={(checked) => onUseDateRangeChange?.(Boolean(checked))}
                  />
                  <Label htmlFor="settings-date-range" className="cursor-pointer">
                    Limit by date range
                  </Label>
                </div>

                {dateRangeAvailable ? (
                  useDateRange ? (
                    <div className="grid gap-2 sm:grid-cols-2">
                      <InputWithContext
                        id="settings-start-date"
                        type="date"
                        value={startDate}
                        onChange={(event) => onStartDateChange?.(event.target.value)}
                        className="h-11 rounded-xl"
                      />
                      <InputWithContext
                        id="settings-end-date"
                        type="date"
                        value={endDate}
                        onChange={(event) => onEndDateChange?.(event.target.value)}
                        className="h-11 rounded-xl"
                      />
                    </div>
                  ) : null
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Date range is only available for public fetches.
                  </p>
                )}
              </div>

              <p className="text-xs text-muted-foreground">
                Fetch defaults follow the normal settings flow. Click <span className="font-medium text-foreground">Save Changes</span> to apply them.
              </p>
            </div>
          </div>
        </section>
      ) : null}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Left Column */}
        <div className="space-y-4">
          {/* Download Path */}
          <div className="space-y-2">
            <Label htmlFor="download-path">Download Path</Label>
            <div className="flex gap-2">
              <InputWithContext
                id="download-path"
                value={tempSettings.downloadPath}
                onChange={(e) => setTempSettings((prev) => ({ ...prev, downloadPath: e.target.value }))}
                placeholder="C:\Users\YourUsername\Pictures"
              />
              <Button type="button" onClick={handleBrowseFolder} className="gap-1.5">
                <FolderOpen className="h-4 w-4" />
                Browse
              </Button>
            </div>
          </div>

          {/* Theme Mode */}
          <div className="space-y-2">
            <Label htmlFor="theme-mode">Mode</Label>
            <Select
              value={tempSettings.themeMode}
              onValueChange={(value: "auto" | "light" | "dark") => setTempSettings((prev) => ({ ...prev, themeMode: value }))}
            >
              <SelectTrigger id="theme-mode">
                <SelectValue placeholder="Select theme mode" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">Auto</SelectItem>
                <SelectItem value="light">Light</SelectItem>
                <SelectItem value="dark">Dark</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Accent */}
          <div className="space-y-2">
            <Label htmlFor="theme">Accent</Label>
            <Select
              value={tempSettings.theme}
              onValueChange={(value) => setTempSettings((prev) => ({ ...prev, theme: value }))}
            >
              <SelectTrigger id="theme">
                <SelectValue placeholder="Select a theme" />
              </SelectTrigger>
              <SelectContent>
                {themes.map((theme) => (
                  <SelectItem key={theme.name} value={theme.name}>
                    <span className="flex items-center gap-2">
                      <span
                        className="w-3 h-3 rounded-full border border-border"
                        style={{
                          backgroundColor: isDark ? theme.cssVars.dark.primary : theme.cssVars.light.primary
                        }}
                      />
                      {theme.label}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Font */}
          <div className="space-y-2">
            <Label htmlFor="font">Font</Label>
            <Select
              value={tempSettings.fontFamily}
              onValueChange={(value: FontFamily) => setTempSettings((prev) => ({ ...prev, fontFamily: value }))}
            >
              <SelectTrigger id="font">
                <SelectValue placeholder="Select a font" />
              </SelectTrigger>
              <SelectContent>
                {FONT_OPTIONS.map((font) => (
                  <SelectItem key={font.value} value={font.value}>
                    <span style={{ fontFamily: font.fontFamily }}>{font.label}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Sound Effects */}
          <div className="flex items-center gap-3 pt-2">
            <Label htmlFor="sfx-enabled" className="cursor-pointer text-sm">Sound Effects</Label>
            <Switch
              id="sfx-enabled"
              checked={tempSettings.sfxEnabled}
              onCheckedChange={(checked) => setTempSettings(prev => ({ ...prev, sfxEnabled: checked }))}
            />
          </div>
        </div>

        {/* Right Column */}
        <div className="space-y-4">
          {/* Metadata Embedding */}
          <div className="space-y-2">
            <Label className="flex items-center gap-2">
              Metadata Embedding
              <Tooltip>
                <TooltipTrigger asChild>
                  <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
                </TooltipTrigger>
                <TooltipContent side="top">
                  <p>ExifTool is required to embed tweet URL and original filename into media file metadata</p>
                </TooltipContent>
              </Tooltip>
            </Label>
            <div className="h-9 flex items-center">
              {exiftoolInstalled ? (
                <div className="flex items-center gap-2 text-sm text-green-600 dark:text-green-400">
                  <Check className="h-4 w-4" />
                  Installed
                </div>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-9"
                  onClick={handleDownloadExifTool}
                  disabled={downloadingExifTool}
                >
                  {downloadingExifTool ? (
                    <>
                      <Spinner />
                      Downloading...
                    </>
                  ) : (
                    <>
                      <Download className="h-4 w-4" />
                      Download ExifTool
                    </>
                  )}
                </Button>
              )}
            </div>
          </div>

          {/* GIF Conversion */}
          <div className="space-y-2">
            <Label className="flex items-center gap-2">
              GIF Conversion
              <Tooltip>
                <TooltipTrigger asChild>
                  <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
                </TooltipTrigger>
                <TooltipContent side="top">
                  <p>FFmpeg is required to convert Twitter's MP4 to actual GIF format</p>
                </TooltipContent>
              </Tooltip>
            </Label>
            <div className="h-9 flex items-center">
              {ffmpegInstalled ? (
                <div className="flex items-center gap-2 text-sm text-green-600 dark:text-green-400">
                  <Check className="h-4 w-4" />
                  Installed
                </div>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-9"
                  onClick={handleDownloadFFmpeg}
                  disabled={downloadingFFmpeg}
                >
                  {downloadingFFmpeg ? (
                    <>
                      <Spinner />
                      Downloading...
                    </>
                  ) : (
                    <>
                      <Download className="h-4 w-4" />
                      Download FFmpeg
                    </>
                  )}
                </Button>
              )}
            </div>
          </div>

          {/* GIF Quality - only show if FFmpeg installed */}
          {ffmpegInstalled && (
            <div className="space-y-2">
              <Label htmlFor="gif-quality">GIF Quality</Label>
              <div className="flex items-center gap-2">
                <Select
                  value={tempSettings.gifQuality}
                  onValueChange={(value: GifQuality) => {
                    setTempSettings((prev) => ({
                      ...prev,
                      gifQuality: value,
                    }));
                  }}
                >
                  <SelectTrigger id="gif-quality" className="w-auto">
                    <SelectValue placeholder="Select quality" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="fast">Fast</SelectItem>
                    <SelectItem value="better">Better</SelectItem>
                  </SelectContent>
                </Select>
                <Select
                  value={tempSettings.gifResolution}
                  onValueChange={(value: GifResolution) => setTempSettings((prev) => ({ ...prev, gifResolution: value }))}
                >
                  <SelectTrigger id="gif-resolution" className="w-auto">
                    <SelectValue placeholder="Resolution" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="original">Original</SelectItem>
                    <SelectItem value="high">High (800px)</SelectItem>
                    <SelectItem value="medium">Medium (600px)</SelectItem>
                    <SelectItem value="low">Low (400px)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}

          {/* Proxy */}
          <div className="space-y-2">
            <Label htmlFor="proxy" className="flex items-center gap-2">
              Proxy
              <Tooltip>
                <TooltipTrigger asChild>
                  <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
                </TooltipTrigger>
                <TooltipContent side="top">
                  <p>If download fails, try using a proxy server</p>
                </TooltipContent>
              </Tooltip>
            </Label>
            <InputWithContext
              id="proxy"
              value={tempSettings.proxy || ""}
              onChange={(e) => setTempSettings((prev) => ({ ...prev, proxy: e.target.value }))}
              placeholder="http://proxy:port or socks5://proxy:port (optional)"
              className="w-[90%]"
            />
          </div>

          {/* Fetch Timeout */}
          <div className="space-y-2">
            <Label htmlFor="fetch-timeout" className="flex items-center gap-2">
              Fetch Timeout
              <Tooltip>
                <TooltipTrigger asChild>
                  <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
                </TooltipTrigger>
                <TooltipContent side="top">
                  <p>Timeout in seconds. Fetch stops automatically when reached</p>
                </TooltipContent>
              </Tooltip>
            </Label>
            <InputWithContext
              id="fetch-timeout"
              type="number"
              value={tempSettings.fetchTimeout || 60}
              onChange={(e) => {
                const inputValue = e.target.value;
                // Allow empty input for user to type freely
                if (inputValue === "") {
                  setTempSettings((prev) => ({ ...prev, fetchTimeout: 60 }));
                  return;
                }
                const value = parseInt(inputValue, 10);
                // Allow any number while typing (including values less than min during typing)
                // Validation will happen on blur
                if (!isNaN(value)) {
                  setTempSettings((prev) => ({ ...prev, fetchTimeout: value }));
                }
              }}
              onBlur={(e) => {
                // Validate and clamp value on blur
                const value = parseInt(e.target.value, 10);
                if (isNaN(value) || value < 30) {
                  setTempSettings((prev) => ({ ...prev, fetchTimeout: 30 }));
                } else if (value > 900) {
                  setTempSettings((prev) => ({ ...prev, fetchTimeout: 900 }));
                }
              }}
              placeholder="60"
              className="w-[20%]"
            />
          </div>

          {/* Download Integrity */}
          <div className="space-y-2">
            <Label className="flex items-center gap-2">
              Download Integrity
              <Tooltip>
                <TooltipTrigger asChild>
                  <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
                </TooltipTrigger>
                <TooltipContent side="top">
                  <p>Checks leftover .part files and validates tracked media against remote file sizes</p>
                </TooltipContent>
              </Tooltip>
            </Label>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                className="h-9"
                onClick={handleCheckIntegrity}
                disabled={checkingIntegrity}
              >
                {checkingIntegrity ? (
                  <>
                    <Spinner />
                    Checking...
                  </>
                ) : (
                  <>
                    <FileCheck className="h-4 w-4" />
                    Check Current Folder
                  </>
                )}
              </Button>
              {integrityReport && (
                <span className="text-xs text-muted-foreground">
                  Last scan: {integrityReport.partial_files + integrityReport.incomplete_files} issue(s),
                  {" "} {integrityReport.checked_files} checked
                </span>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              Files that are no longer in the database can be counted but may not be fully verifiable.
            </p>
          </div>

        </div>
      </div>

      {/* Actions */}
      <div className="flex gap-2 justify-between pt-4 border-t">
        <Button variant="outline" onClick={() => setShowResetConfirm(true)} className="gap-1.5">
          <RotateCcw className="h-4 w-4" />
          Reset to Default
        </Button>
        <Button onClick={handleSave} className="gap-1.5">
          <Save className="h-4 w-4" />
          Save Changes
        </Button>
      </div>

      {/* Reset Confirmation Dialog */}
      <Dialog open={showResetConfirm} onOpenChange={setShowResetConfirm}>
        <DialogContent className="max-w-md [&>button]:hidden">
          <DialogHeader>
            <DialogTitle>Reset to Default?</DialogTitle>
            <DialogDescription>
              This will reset all settings to their default values. Your custom configurations will be lost.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowResetConfirm(false)}>Cancel</Button>
            <Button onClick={handleReset}>Reset</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showIntegrityReport} onOpenChange={setShowIntegrityReport}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Download Integrity Report</DialogTitle>
            <DialogDescription>
              Checked {integrityReport?.checked_files ?? 0} tracked file(s) under {integrityReport?.download_path || tempSettings.downloadPath}
            </DialogDescription>
          </DialogHeader>

          {integrityReport && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <div className="rounded-lg border p-3">
                  <div className="text-xs text-muted-foreground">Scanned</div>
                  <div className="text-lg font-semibold">{integrityReport.scanned_files}</div>
                </div>
                <div className="rounded-lg border p-3">
                  <div className="text-xs text-muted-foreground">Checked</div>
                  <div className="text-lg font-semibold">{integrityReport.checked_files}</div>
                </div>
                <div className="rounded-lg border p-3">
                  <div className="text-xs text-muted-foreground">Incomplete</div>
                  <div className="text-lg font-semibold">{integrityReport.incomplete_files}</div>
                </div>
                <div className="rounded-lg border p-3">
                  <div className="text-xs text-muted-foreground">Partial</div>
                  <div className="text-lg font-semibold">{integrityReport.partial_files}</div>
                </div>
                <div className="rounded-lg border p-3">
                  <div className="text-xs text-muted-foreground">Complete</div>
                  <div className="text-lg font-semibold">{integrityReport.complete_files}</div>
                </div>
                <div className="rounded-lg border p-3">
                  <div className="text-xs text-muted-foreground">Untracked</div>
                  <div className="text-lg font-semibold">{integrityReport.untracked_files}</div>
                </div>
                <div className="rounded-lg border p-3">
                  <div className="text-xs text-muted-foreground">Unverifiable</div>
                  <div className="text-lg font-semibold">{integrityReport.unverifiable_files}</div>
                </div>
              </div>

              {integrityReport.issues.length > 0 ? (
                <div className="space-y-2">
                  <div className="text-sm font-medium">Problems Found</div>
                  <div className="max-h-[360px] overflow-y-auto rounded-lg border">
                    {integrityReport.issues.map((issue) => (
                      <div key={`${issue.relative_path}-${issue.reason}`} className="border-b p-3 last:border-b-0">
                        <div className="font-mono text-xs break-all">{issue.relative_path}</div>
                        <div className="mt-1 text-sm">{formatIntegrityReason(issue.reason)}</div>
                        <div className="mt-1 text-xs text-muted-foreground">
                          Local: {formatBytes(issue.local_size)}
                          {issue.remote_size > 0 ? ` • Remote: ${formatBytes(issue.remote_size)}` : ""}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="rounded-lg border p-4 text-sm text-green-600 dark:text-green-400">
                  No incomplete files found in the tracked media set.
                </div>
              )}

              {(integrityReport.untracked_files > 0 || integrityReport.unverifiable_files > 0) && (
                <div className="rounded-lg border p-3 text-xs text-muted-foreground">
                  {integrityReport.untracked_files > 0 && (
                    <div>{integrityReport.untracked_files} file(s) could not be matched back to saved database entries.</div>
                  )}
                  {integrityReport.unverifiable_files > 0 && (
                    <div>{integrityReport.unverifiable_files} tracked file(s) could not be verified because remote size was unavailable.</div>
                  )}
                </div>
              )}
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={handleOpenIntegrityFolder}>Open Folder</Button>
            <Button onClick={() => setShowIntegrityReport(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
