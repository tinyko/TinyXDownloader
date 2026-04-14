import {
  CheckDownloadIntegrity,
  DownloadExifTool,
  DownloadFFmpeg,
  IsExifToolInstalled,
  IsFFmpegInstalled,
  OpenFolder,
  SelectFolder,
} from "../../wailsjs/go/main/App";
import type { DownloadIntegrityMode, DownloadIntegrityReport } from "@/types/settings";

export function selectDownloadFolder(currentPath: string) {
  return SelectFolder(currentPath);
}

export function checkFFmpegInstalled() {
  return IsFFmpegInstalled();
}

export function downloadFFmpegBinary() {
  return DownloadFFmpeg();
}

export function checkExifToolInstalled() {
  return IsExifToolInstalled();
}

export function downloadExifToolBinary() {
  return DownloadExifTool();
}

export function runDownloadIntegrityCheck(
  downloadPath: string,
  proxy: string,
  mode: DownloadIntegrityMode
) {
  return CheckDownloadIntegrity({
    download_path: downloadPath,
    proxy,
    mode,
  }) as Promise<DownloadIntegrityReport>;
}

export function openSettingsFolder(path: string) {
  return OpenFolder(path);
}
