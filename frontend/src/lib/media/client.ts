import type { AccountInfo, TimelineEntry } from "@/types/api";
import { getSettings } from "@/lib/settings";
import {
  buildAccountFolderPath,
  buildAccountOutputDir,
  getAccountFolderName,
} from "@/lib/media/utils";
import {
  CheckFolderExists,
  CheckGifsFolderHasMP4,
  ConvertGIFs,
  DownloadMediaWithMetadata,
  IsFFmpegInstalled,
  OpenFolder,
} from "../../../wailsjs/go/main/App";
import { main } from "../../../wailsjs/go/models";

export interface MediaToolingSnapshot {
  ffmpegInstalled: boolean;
  folderExists: boolean;
  gifsFolderHasMP4: boolean;
}

function buildMediaRequestItems(items: TimelineEntry[]) {
  return items.map(
    (item) =>
      new main.MediaItemRequest({
        url: item.url,
        date: item.date,
        tweet_id: item.tweet_id,
        type: item.type,
        content: item.content || "",
        original_filename: item.original_filename || "",
        author_username: item.author_username || "",
      })
  );
}

export function getMediaAccountFolderName(accountInfo: AccountInfo) {
  return getAccountFolderName(accountInfo);
}

export function getMediaOutputDir(accountInfo: AccountInfo) {
  const settings = getSettings();
  return buildAccountOutputDir(settings.downloadPath, accountInfo);
}

export async function readMediaToolingSnapshot(accountFolderName: string): Promise<MediaToolingSnapshot> {
  const settings = getSettings();
  const basePath = settings.downloadPath;
  const ffmpegInstalled = await IsFFmpegInstalled();

  if (!basePath || !accountFolderName) {
    return {
      ffmpegInstalled,
      folderExists: false,
      gifsFolderHasMP4: false,
    };
  }

  const folderExists = await CheckFolderExists(basePath, accountFolderName);
  if (!folderExists) {
    return {
      ffmpegInstalled,
      folderExists,
      gifsFolderHasMP4: false,
    };
  }

  const gifsFolderHasMP4 = await CheckGifsFolderHasMP4(basePath, accountFolderName);
  return {
    ffmpegInstalled,
    folderExists,
    gifsFolderHasMP4,
  };
}

export async function downloadMediaEntries(accountInfo: AccountInfo, items: TimelineEntry[]) {
  const settings = getSettings();
  return DownloadMediaWithMetadata(
    new main.DownloadMediaWithMetadataRequest({
      items: buildMediaRequestItems(items),
      output_dir: getMediaOutputDir(accountInfo),
      username: accountInfo.name,
      proxy: settings.proxy || "",
    })
  );
}

export async function openMediaFolder(accountFolderName: string) {
  const settings = getSettings();
  const folderPath = buildAccountFolderPath(settings.downloadPath, accountFolderName);

  try {
    await OpenFolder(folderPath);
  } catch {
    await OpenFolder(settings.downloadPath);
  }
}

export async function convertMediaGifs(accountFolderName: string) {
  const settings = getSettings();
  const folderPath = buildAccountFolderPath(settings.downloadPath, accountFolderName);

  return ConvertGIFs({
    folder_path: folderPath,
    quality: settings.gifQuality || "fast",
    resolution: settings.gifResolution || "high",
    delete_original: false,
  });
}
