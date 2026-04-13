import { useCallback, useMemo } from "react";

import type { AccountInfo, TimelineEntry } from "@/types/api";
import type {
  GlobalDownloadSessionMeta,
  GlobalDownloadState,
} from "@/types/download";
import { useDownloadItemStatusMap } from "@/hooks/download/useDownloadItemStatusMap";
import { getTimelineItemKey } from "@/hooks/media/useMediaTimelineModel";
import {
  downloadMediaEntries,
  getMediaAccountFolderName,
  openMediaFolder,
} from "@/lib/media/client";
import { formatNumberWithComma } from "@/lib/media/utils";
import { logger } from "@/lib/logger";
import { toastWithSound as toast } from "@/lib/toast-with-sound";
import { openExternal } from "@/lib/utils";

interface DownloadableItem {
  item: TimelineEntry;
  originalIndex: number;
}

interface UseMediaDownloadActionsArgs {
  accountInfo: AccountInfo;
  onDownloadSessionStart?: (meta: GlobalDownloadSessionMeta) => void;
  downloadState?: GlobalDownloadState | null;
  downloadMeta?: GlobalDownloadSessionMeta | null;
  onRefreshArtifacts?: () => void | Promise<void>;
}

export function useMediaDownloadActions({
  accountInfo,
  onDownloadSessionStart,
  downloadState = null,
  downloadMeta = null,
  onRefreshArtifacts,
}: UseMediaDownloadActionsArgs) {
  const accountFolderName = useMemo(
    () => getMediaAccountFolderName(accountInfo),
    [accountInfo]
  );

  const isDownloading = Boolean(
    downloadState?.in_progress &&
      downloadMeta?.source === "media-list" &&
      downloadMeta.targetKey === accountInfo.name
  );

  const {
    downloadingItem,
    downloadedItems,
    failedItems,
    skippedItems,
    beginSingleDownload,
    endSingleDownload,
    beginBulkDownload,
    clearBulkDownload,
  } = useDownloadItemStatusMap({ resetKey: accountInfo.name });

  const refreshArtifacts = useCallback(async () => {
    await onRefreshArtifacts?.();
  }, [onRefreshArtifacts]);

  const handleDownloadItems = useCallback(
    async (itemsWithIndices: DownloadableItem[]) => {
      if (itemsWithIndices.length === 0) {
        toast.error("No media to download");
        return;
      }

      const targetLabel =
        accountInfo.nick === "My Bookmarks"
          ? "My Bookmarks"
          : accountInfo.nick === "My Likes"
            ? "My Likes"
            : `@${accountInfo.name}`;

      onDownloadSessionStart?.({
        source: "media-list",
        title: `Downloading ${targetLabel}`,
        subtitle: `${formatNumberWithComma(itemsWithIndices.length)} item(s) selected`,
        targetKey: accountInfo.name,
        accountName: accountInfo.name,
      });

      beginBulkDownload(itemsWithIndices.map(({ item }) => getTimelineItemKey(item)));
      logger.info(`Starting download of ${itemsWithIndices.length} files...`);

      try {
        const response = await downloadMediaEntries(
          accountInfo,
          itemsWithIndices.map(({ item }) => item)
        );
        if (!response.success) {
          logger.error(response.message);
          toast.error("Download failed");
          return;
        }

        const parts: string[] = [];
        if (response.downloaded > 0) {
          parts.push(`${response.downloaded} file${response.downloaded !== 1 ? "s" : ""} downloaded`);
        }
        if (response.skipped > 0) {
          parts.push(
            `${response.skipped} file${response.skipped !== 1 ? "s" : ""} already exist${
              response.skipped !== 1 ? "" : "s"
            }`
          );
        }
        if (response.failed > 0) {
          parts.push(`${response.failed} failed`);
        }

        const message = parts.length > 0 ? parts.join(", ") : "Download completed";
        if (response.downloaded === 0 && response.failed === 0 && response.skipped > 0) {
          logger.info(message);
          toast.info(message);
        } else {
          logger.success(message);
          toast.success(message);
        }
        await refreshArtifacts();
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        logger.error(`Download failed: ${errorMsg}`);
        toast.error("Download failed");
      } finally {
        clearBulkDownload();
      }
    },
    [
      accountInfo,
      beginBulkDownload,
      clearBulkDownload,
      onDownloadSessionStart,
      refreshArtifacts,
    ]
  );

  const handleSingleMediaDownload = useCallback(
    async (item: TimelineEntry, itemKey: string) => {
      beginSingleDownload(itemKey);

      try {
        const response = await downloadMediaEntries(accountInfo, [item]);
        if (response.success) {
          await refreshArtifacts();
          return;
        }

        toast.error(response.message || "Download failed");
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        toast.error(`Download failed: ${errorMsg}`);
      } finally {
        endSingleDownload(1000);
      }
    },
    [accountInfo, beginSingleDownload, endSingleDownload, refreshArtifacts]
  );

  const handleOpenFolder = useCallback(async () => {
    try {
      await openMediaFolder(accountFolderName);
    } catch {
      toast.error("Could not open folder");
    }
  }, [accountFolderName]);

  const handleOpenTweet = useCallback(
    (tweetId: string) => {
      openExternal(`https://x.com/${accountInfo.name}/status/${tweetId}`);
    },
    [accountInfo.name]
  );

  return {
    accountFolderName,
    isDownloading,
    downloadingItem,
    downloadedItems,
    failedItems,
    skippedItems,
    handleDownloadItems,
    handleSingleMediaDownload,
    handleOpenFolder,
    handleOpenTweet,
  };
}
