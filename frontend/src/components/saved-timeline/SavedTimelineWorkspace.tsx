import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft } from "lucide-react";

import { SavedTimelineGalleryView } from "@/components/saved-timeline/SavedTimelineGalleryView";
import { SavedTimelineListView } from "@/components/saved-timeline/SavedTimelineListView";
import { SavedTimelinePreviewOverlay } from "@/components/saved-timeline/SavedTimelinePreviewOverlay";
import { SavedTimelineSummaryCard } from "@/components/saved-timeline/SavedTimelineSummaryCard";
import { SavedTimelineToolbar } from "@/components/saved-timeline/SavedTimelineToolbar";
import type {
  DownloadSessionFailHandler,
  DownloadSessionFinishHandler,
  GlobalDownloadSessionMeta,
  GlobalDownloadState,
} from "@/types/download";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { useIndexedTimelinePreview } from "@/hooks/media/useIndexedTimelinePreview";
import { useSavedAccountFolderExists } from "@/hooks/saved/useSavedAccountFolderExists";
import { useSavedTimelineActions } from "@/hooks/saved/useSavedTimelineActions";
import { useSavedTimelinePager } from "@/hooks/saved/useSavedTimelinePager";
import { loadSavedTimelineBootstrap } from "@/lib/fetch/snapshot-client";
import type { FetchScope } from "@/lib/fetch/state";
import type { AccountTimelineBootstrap } from "@/types/api";
import { backend } from "../../../wailsjs/go/models";

interface SavedTimelineWorkspaceProps {
  account: backend.AccountListItem;
  scope: FetchScope;
  downloadState?: GlobalDownloadState | null;
  downloadMeta?: GlobalDownloadSessionMeta | null;
  onDownloadSessionStart?: (meta: GlobalDownloadSessionMeta) => void;
  onDownloadSessionFinish?: DownloadSessionFinishHandler;
  onDownloadSessionFail?: DownloadSessionFailHandler;
}

export function SavedTimelineWorkspace({
  account,
  scope,
  downloadState = null,
  downloadMeta = null,
  onDownloadSessionStart,
  onDownloadSessionFinish,
  onDownloadSessionFail,
}: SavedTimelineWorkspaceProps) {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [filterType, setFilterType] = useState("all");
  const [sortBy, setSortBy] = useState("date-desc");
  const [viewMode, setViewMode] = useState<"gallery" | "list">("list");
  const [showScrollTop, setShowScrollTop] = useState(false);
  const [bootstrapState, setBootstrapState] = useState<{
    resetKey: string;
    data: AccountTimelineBootstrap | null;
  }>({
    resetKey: "",
    data: null,
  });

  const accountFolderName = useMemo(() => {
    if (account.username === "bookmarks") {
      return "My Bookmarks";
    }
    if (account.username === "likes") {
      return "My Likes";
    }
    return account.username;
  }, [account.username]);

  const { items, loading, loadingMore, hasMore, loadMoreRef } =
    useSavedTimelinePager(scope, filterType, sortBy);
  const bootstrapResetKey = `${scope.username}|${scope.mediaType}|${scope.timelineType}|${
    scope.retweets ? "1" : "0"
  }|${scope.queryKey}|${filterType}`;
  const bootstrap =
    bootstrapState.resetKey === bootstrapResetKey ? bootstrapState.data : null;
  const loadingBootstrap = bootstrapState.resetKey !== bootstrapResetKey;
  const accountInfo = bootstrap?.summary.account_info;
  const totalItems = bootstrap?.total_items ?? account.total_media ?? 0;
  const mediaCounts = bootstrap?.media_counts ?? {
    photo: 0,
    video: 0,
    gif: 0,
    text: 0,
  };

  useEffect(() => {
    let active = true;

    const loadBootstrap = async () => {
      const data = await loadSavedTimelineBootstrap(scope, filterType);
      if (!active) {
        return;
      }
      setBootstrapState({
        resetKey: bootstrapResetKey,
        data,
      });
    };

    void loadBootstrap();
    return () => {
      active = false;
    };
  }, [
    bootstrapResetKey,
    filterType,
    scope,
  ]);

  const previewResetKey = `${scope.username}|${scope.mediaType}|${scope.timelineType}|${
    scope.retweets ? "1" : "0"
  }|${scope.queryKey}|${filterType}|${sortBy}`;
  const {
    indexedItems,
    previewIndex,
    openPreview,
    closePreview,
    goToPrevious,
    goToNext,
  } = useIndexedTimelinePreview(items, { resetKey: previewResetKey });
  const {
    selectedItems,
    selectionCount,
    allLoadedSelected,
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
    disablePrimaryDownloadAction,
  } = useSavedTimelineActions({
    account,
    scope,
    indexedItems,
    totalItems,
    loading,
    accountFolderName,
    resetKey: previewResetKey,
    downloadState,
    downloadMeta,
    onDownloadSessionStart,
    onDownloadSessionFinish,
    onDownloadSessionFail,
  });
  const folderExists = useSavedAccountFolderExists(
    accountFolderName,
    folderRefreshKey
  );

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) {
      return;
    }

    const handleScroll = () => {
      setShowScrollTop(container.scrollTop > 300);
    };

    container.addEventListener("scroll", handleScroll, { passive: true });
    handleScroll();
    return () => container.removeEventListener("scroll", handleScroll);
  }, []);

  const previewItem = previewIndex !== null ? items[previewIndex] : null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div
        ref={scrollContainerRef}
        className="min-h-0 flex-1 overflow-y-auto pr-1"
      >
        <div className="space-y-4 pb-4">
          <SavedTimelineSummaryCard
            profileImage={accountInfo?.profile_image}
            displayName={accountInfo?.nick || account.name}
            username={account.username}
            totalItems={totalItems}
          />

          <SavedTimelineToolbar
            sortBy={sortBy}
            onSortByChange={setSortBy}
            filterType={filterType}
            onFilterTypeChange={setFilterType}
            mediaCounts={mediaCounts}
            totalItems={totalItems}
            viewMode={viewMode}
            onViewModeChange={setViewMode}
            folderExists={folderExists}
            onOpenFolder={handleOpenFolder}
            onDownload={handleDownload}
            disablePrimaryDownloadAction={disablePrimaryDownloadAction}
            selectionCount={selectionCount}
            indexedItemCount={indexedItems.length}
            allLoadedSelected={allLoadedSelected}
            onToggleSelectAll={toggleSelectAll}
            hasMore={hasMore}
          />

          {loadingBootstrap || loading ? (
            <div className="flex h-[320px] items-center justify-center rounded-2xl border border-border/70 bg-background/40">
              <Spinner />
            </div>
          ) : viewMode === "list" ? (
            <SavedTimelineListView
              indexedItems={indexedItems}
              selectedItems={selectedItems}
              downloadedItems={downloadedItems}
              failedItems={failedItems}
              skippedItems={skippedItems}
              downloadingItem={downloadingItem}
              onToggleItem={toggleItem}
              onOpenPreview={openPreview}
              onDownloadItem={handleSingleItemDownload}
              accountUsername={account.username}
            />
          ) : (
            <SavedTimelineGalleryView
              indexedItems={indexedItems}
              selectedItems={selectedItems}
              downloadedItems={downloadedItems}
              failedItems={failedItems}
              skippedItems={skippedItems}
              downloadingItem={downloadingItem}
              onToggleItem={toggleItem}
              onOpenPreview={openPreview}
              onDownloadItem={handleSingleItemDownload}
              accountUsername={account.username}
            />
          )}

          {hasMore ? (
            <div
              ref={loadMoreRef}
              className="flex h-20 w-full items-center justify-center"
            >
              {loadingMore ? (
                <Spinner />
              ) : (
                <span className="text-sm text-muted-foreground">
                  Loading more…
                </span>
              )}
            </div>
          ) : null}
        </div>
      </div>

      {showScrollTop ? (
        <Button
          className="absolute bottom-6 right-6 z-10 rounded-full shadow-lg"
          size="icon"
          onClick={() =>
            scrollContainerRef.current?.scrollTo({ top: 0, behavior: "smooth" })
          }
        >
          <ChevronLeft className="h-4 w-4 rotate-90" />
        </Button>
      ) : null}

      {previewItem && previewIndex !== null ? (
        <SavedTimelinePreviewOverlay
          item={previewItem}
          itemIndex={previewIndex}
          totalItems={items.length}
          accountUsername={account.username}
          hasPrevious={previewIndex > 0}
          hasNext={previewIndex < items.length - 1}
          onPrevious={goToPrevious}
          onNext={goToNext}
          onClose={closePreview}
        />
      ) : null}
    </div>
  );
}
