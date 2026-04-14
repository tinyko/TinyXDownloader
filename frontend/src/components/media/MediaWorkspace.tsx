import { useCallback } from "react";
import { ArrowUp } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { MediaWorkspaceProps } from "@/types/media";
import { getTimelineItemKey } from "@/hooks/media/useMediaTimelineModel";
import { useMediaWorkspaceActions } from "@/hooks/media/useMediaWorkspaceActions";
import { useMediaWorkspaceViewState } from "@/hooks/media/useMediaWorkspaceViewState";
import { MediaWorkspaceSummary } from "@/components/media/MediaWorkspaceSummary";
import { MediaWorkspaceToolbar } from "@/components/media/MediaWorkspaceToolbar";
import { MediaWorkspaceListView } from "@/components/media/MediaWorkspaceListView";
import { MediaWorkspaceGalleryView } from "@/components/media/MediaWorkspaceGalleryView";
import { MediaPreviewOverlay } from "@/components/media/MediaPreviewOverlay";

export function MediaWorkspace({
  accountInfo,
  timeline,
  totalUrls,
  fetchedMediaType = "all",
  newMediaCount = null,
  downloadState = null,
  downloadMeta = null,
  onDownloadSessionStart,
  onDownloadSessionFinish,
  onDownloadSessionFail,
}: MediaWorkspaceProps) {
  const {
    scrollContainerRef,
    loadMoreRef,
    selectedItems,
    sortBy,
    setSortBy,
    filterType,
    setFilterType,
    viewMode,
    setViewMode,
    visibleCount,
    showScrollTop,
    mediaCounts,
    filteredTimeline,
    visibleTimeline,
    indexedTimeline,
    previewIndex,
    openPreview,
    closePreview,
    goToPrevious,
    goToNext,
    toggleSelectAll,
    toggleItem,
    scrollToTop,
  } = useMediaWorkspaceViewState(timeline);
  const actions = useMediaWorkspaceActions({
    accountInfo,
    onDownloadSessionStart,
    onDownloadSessionFinish,
    onDownloadSessionFail,
    downloadState,
    downloadMeta,
  });

  const handleBulkDownload = useCallback(async () => {
    const itemsWithIndices =
      selectedItems.size > 0
        ? indexedTimeline
            .filter((entry) => selectedItems.has(entry.key))
            .map((entry) => ({ item: entry.item, originalIndex: entry.index }))
        : indexedTimeline.map((entry) => ({
            item: entry.item,
            originalIndex: entry.index,
          }));

    await actions.handleDownloadItems(itemsWithIndices);
  }, [actions, indexedTimeline, selectedItems]);

  const previewItem =
    previewIndex !== null ? filteredTimeline[previewIndex] : null;
  const previewItemKey = previewItem ? getTimelineItemKey(previewItem) : null;
  const previewDownloadStatus =
    previewItemKey && actions.skippedItems.has(previewItemKey)
      ? "skipped"
      : previewItemKey && actions.downloadedItems.has(previewItemKey)
        ? "downloaded"
        : previewItemKey && actions.failedItems.has(previewItemKey)
          ? "failed"
          : "idle";

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div ref={scrollContainerRef} className="min-h-0 flex-1 overflow-y-auto pr-1">
        <div className="space-y-4 pb-4">
          <MediaWorkspaceSummary
            accountInfo={accountInfo}
            totalUrls={totalUrls}
            newMediaCount={newMediaCount}
          />

          <MediaWorkspaceToolbar
            fetchedMediaType={fetchedMediaType}
            totalUrls={totalUrls}
            mediaCounts={mediaCounts}
            sortBy={sortBy}
            onSortByChange={setSortBy}
            filterType={filterType}
            onFilterTypeChange={setFilterType}
            viewMode={viewMode}
            onViewModeChange={setViewMode}
            folderExists={actions.folderExists}
            ffmpegInstalled={actions.ffmpegInstalled}
            gifsFolderHasMP4={actions.gifsFolderHasMP4}
            isConverting={actions.isConverting}
            isDownloading={actions.isDownloading}
            selectedCount={selectedItems.size}
            filteredCount={filteredTimeline.length}
            allFilteredSelected={
              selectedItems.size === filteredTimeline.length &&
              filteredTimeline.length > 0
            }
            onToggleSelectAll={toggleSelectAll}
            onOpenFolder={actions.handleOpenFolder}
            onConvertGifs={actions.handleConvertGifs}
            onDownload={handleBulkDownload}
          />

          {viewMode === "list" ? (
            <MediaWorkspaceListView
              indexedTimeline={indexedTimeline}
              selectedItems={selectedItems}
              downloadedItems={actions.downloadedItems}
              failedItems={actions.failedItems}
              skippedItems={actions.skippedItems}
              downloadingItem={actions.downloadingItem}
              onToggleItem={toggleItem}
              onOpenPreview={openPreview}
              onSingleDownload={actions.handleSingleMediaDownload}
              onOpenTweet={actions.handleOpenTweet}
            />
          ) : (
            <MediaWorkspaceGalleryView
              items={visibleTimeline}
              selectedItems={selectedItems}
              downloadedItems={actions.downloadedItems}
              failedItems={actions.failedItems}
              skippedItems={actions.skippedItems}
              downloadingItem={actions.downloadingItem}
              loadMoreRef={loadMoreRef}
              hasMore={visibleCount < filteredTimeline.length}
              getItemKey={getTimelineItemKey}
              onToggleItem={toggleItem}
              onOpenPreview={openPreview}
              onSingleDownload={actions.handleSingleMediaDownload}
              onOpenTweet={actions.handleOpenTweet}
            />
          )}
        </div>
      </div>

      {previewItem && previewIndex !== null ? (
        <MediaPreviewOverlay
          item={previewItem}
          previewIndex={previewIndex}
          totalItems={filteredTimeline.length}
          canGoPrevious={previewIndex > 0}
          canGoNext={previewIndex < filteredTimeline.length - 1}
          downloadingItem={actions.downloadingItem === previewItemKey}
          downloadStatus={previewDownloadStatus}
          onClose={closePreview}
          onPrevious={goToPrevious}
          onNext={goToNext}
          onDownload={() =>
            previewItemKey
              ? actions.handleSingleMediaDownload(previewItem, previewItemKey)
              : Promise.resolve()
          }
          onOpenTweet={() => actions.handleOpenTweet(previewItem.tweet_id)}
        />
      ) : null}

      {showScrollTop && previewIndex === null ? (
        <Button
          variant="default"
          size="icon"
          className="fixed bottom-6 left-1/2 z-30 h-9 w-9 -translate-x-1/2 rounded-full shadow-lg"
          onClick={scrollToTop}
          aria-label="Scroll to top"
        >
          <ArrowUp className="h-4 w-4" />
        </Button>
      ) : null}
    </div>
  );
}
