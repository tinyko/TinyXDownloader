import { useCallback, useEffect, useMemo, useState } from "react";

import { getSettings } from "@/lib/settings";
import { toastWithSound as toast } from "@/lib/toast-with-sound";
import type { IndexedTimelineItem } from "@/hooks/media/useIndexedTimelinePreview";
import { useDownloadItemStatusMap } from "@/hooks/download/useDownloadItemStatusMap";
import type { SavedTimelineItem } from "@/types/api";
import type {
  GlobalDownloadSessionMeta,
  GlobalDownloadState,
} from "@/types/download";
import { backend, main } from "../../../wailsjs/go/models";
import {
  DownloadMediaWithMetadata,
  DownloadSavedScopes,
  GetFolderPath,
  OpenFolder,
} from "../../../wailsjs/go/main/App";
import type { FetchScope } from "@/lib/fetch/state";

interface UseSavedTimelineActionsOptions {
  account: backend.AccountListItem;
  scope: FetchScope;
  indexedItems: IndexedTimelineItem<SavedTimelineItem>[];
  totalItems: number;
  loading: boolean;
  accountFolderName: string;
  resetKey: string;
  downloadState?: GlobalDownloadState | null;
  downloadMeta?: GlobalDownloadSessionMeta | null;
  onDownloadSessionStart?: (meta: GlobalDownloadSessionMeta) => void;
}

export function useSavedTimelineActions({
  account,
  scope,
  indexedItems,
  totalItems,
  loading,
  accountFolderName,
  resetKey,
  downloadState = null,
  downloadMeta = null,
  onDownloadSessionStart,
}: UseSavedTimelineActionsOptions) {
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const [folderRefreshVersion, setFolderRefreshVersion] = useState(0);
  const {
    downloadingItem,
    downloadedItems,
    failedItems,
    skippedItems,
    beginSingleDownload,
    endSingleDownload,
    beginBulkDownload,
    clearBulkDownload,
  } = useDownloadItemStatusMap({ resetKey: String(account.id) });

  const isDownloading = Boolean(
    downloadState?.in_progress &&
      downloadMeta?.source === "database-single" &&
      downloadMeta.accountId === account.id
  );

  const selectionCount = selectedItems.size;
  const allLoadedSelected = indexedItems.length > 0 && selectedItems.size === indexedItems.length;
  const folderRefreshKey = `${accountFolderName}|${folderRefreshVersion}`;

  const getOutputDir = useCallback(() => {
    const settings = getSettings();
    if (account.username === "bookmarks" || account.username === "likes") {
      const separator = settings.downloadPath.includes("/") ? "/" : "\\";
      return `${settings.downloadPath}${separator}${accountFolderName}`;
    }
    return settings.downloadPath;
  }, [account.username, accountFolderName]);

  const selectedEntries = useMemo(
    () =>
      selectionCount > 0
        ? indexedItems.filter((entry) => selectedItems.has(entry.key))
        : [],
    [indexedItems, selectedItems, selectionCount]
  );

  useEffect(() => {
    setSelectedItems(new Set());
  }, [resetKey]);

  const markFolderRefresh = useCallback(() => {
    setFolderRefreshVersion((version) => version + 1);
  }, []);

  const toggleSelectAll = useCallback(() => {
    if (selectedItems.size === indexedItems.length) {
      setSelectedItems(new Set());
      return;
    }
    setSelectedItems(new Set(indexedItems.map((entry) => entry.key)));
  }, [indexedItems, selectedItems]);

  const toggleItem = useCallback((itemKey: string) => {
    setSelectedItems((prev) => {
      const next = new Set(prev);
      if (next.has(itemKey)) {
        next.delete(itemKey);
      } else {
        next.add(itemKey);
      }
      return next;
    });
  }, []);

  const handleOpenFolder = useCallback(async () => {
    const settings = getSettings();
    const folderPath = await GetFolderPath(settings.downloadPath, accountFolderName);
    try {
      await OpenFolder(folderPath);
    } catch {
      toast.error("Failed to open folder");
    }
  }, [accountFolderName]);

  const handleSingleItemDownload = useCallback(
    async (item: SavedTimelineItem, itemKey: string) => {
      beginSingleDownload(itemKey);

      try {
        const settings = getSettings();
        const response = await DownloadMediaWithMetadata(
          new main.DownloadMediaWithMetadataRequest({
            items: [
              new main.MediaItemRequest({
                url: item.url,
                date: item.date,
                tweet_id: item.tweet_id,
                type: item.type,
                content: item.content || "",
                original_filename: item.original_filename || "",
                author_username: item.author_username || "",
              }),
            ],
            output_dir: getOutputDir(),
            username: account.username,
            proxy: settings.proxy || "",
          })
        );
        if (response.success) {
          markFolderRefresh();
          return;
        }
        toast.error(response.message || "Download failed");
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        toast.error(`Download failed: ${errorMsg}`);
      } finally {
        endSingleDownload();
      }
    },
    [account.username, beginSingleDownload, endSingleDownload, getOutputDir, markFolderRefresh]
  );

  const handleDownload = useCallback(async () => {
    const settings = getSettings();

    if (selectedEntries.length > 0) {
      beginBulkDownload(selectedEntries.map((entry) => entry.key));
      onDownloadSessionStart?.({
        source: "database-single",
        title: `Downloading @${account.username}`,
        subtitle: `${selectedEntries.length.toLocaleString()} selected item(s)`,
        accountId: account.id,
        accountName: account.username,
        targetKey: `saved-${account.id}`,
      });

      try {
        const response = await DownloadMediaWithMetadata(
          new main.DownloadMediaWithMetadataRequest({
            items: selectedEntries.map(
              (entry) =>
                new main.MediaItemRequest({
                  url: entry.item.url,
                  date: entry.item.date,
                  tweet_id: entry.item.tweet_id,
                  type: entry.item.type,
                  content: entry.item.content || "",
                  original_filename: entry.item.original_filename || "",
                  author_username: entry.item.author_username || "",
                })
            ),
            output_dir: getOutputDir(),
            username: account.username,
            proxy: settings.proxy || "",
          })
        );
        if (response.success) {
          markFolderRefresh();
          toast.success("Selected items downloaded");
        } else {
          toast.error(response.message || "Download failed");
        }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        toast.error(`Download failed: ${errorMsg}`);
      } finally {
        clearBulkDownload();
      }
      return;
    }

    onDownloadSessionStart?.({
      source: "database-single",
      title: `Downloading @${account.username}`,
      subtitle: `${totalItems.toLocaleString()} saved item(s)`,
      accountId: account.id,
      accountName: account.username,
      targetKey: `saved-${account.id}`,
    });

    try {
      const response = await DownloadSavedScopes(
        new main.DownloadSavedScopesRequest({
          scopes: [
            {
              username: scope.username,
              media_type: scope.mediaType || "all",
              timeline_type: scope.timelineType || "timeline",
              retweets: scope.retweets ?? false,
              query_key: scope.queryKey || "",
            },
          ],
          output_dir: settings.downloadPath || "",
          proxy: settings.proxy || "",
        })
      );
      if (response.success) {
        markFolderRefresh();
        toast.success("Saved account download completed");
      } else {
        toast.error(response.message || "Download failed");
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      toast.error(`Download failed: ${errorMsg}`);
    }
  }, [
    account.id,
    account.username,
    beginBulkDownload,
    clearBulkDownload,
    getOutputDir,
    markFolderRefresh,
    onDownloadSessionStart,
    scope.mediaType,
    scope.queryKey,
    scope.retweets,
    scope.timelineType,
    scope.username,
    selectedEntries,
    totalItems,
  ]);

  return {
    selectedItems,
    selectionCount,
    allLoadedSelected,
    isDownloading,
    downloadingItem,
    downloadedItems,
    failedItems,
    skippedItems,
    folderRefreshKey,
    toggleSelectAll,
    toggleItem,
    handleOpenFolder,
    handleSingleItemDownload,
    handleDownload,
    disablePrimaryDownloadAction: isDownloading || loading,
  };
}
