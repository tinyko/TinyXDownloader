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
}: MediaWorkspaceProps) {
  const view = useMediaWorkspaceViewState(timeline);
  const actions = useMediaWorkspaceActions({
    accountInfo,
    onDownloadSessionStart,
    downloadState,
    downloadMeta,
  });

  const handleBulkDownload = useCallback(async () => {
    const itemsWithIndices =
      view.selectedItems.size > 0
        ? view.indexedTimeline
            .filter((entry) => view.selectedItems.has(entry.key))
            .map((entry) => ({ item: entry.item, originalIndex: entry.index }))
        : view.indexedTimeline.map((entry) => ({
            item: entry.item,
            originalIndex: entry.index,
          }));

    await actions.handleDownloadItems(itemsWithIndices);
  }, [actions, view.indexedTimeline, view.selectedItems]);

  const previewItem =
    view.previewIndex !== null ? view.filteredTimeline[view.previewIndex] : null;
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
      <div ref={view.scrollContainerRef} className="min-h-0 flex-1 overflow-y-auto pr-1">
        <div className="space-y-4 pb-4">
          <MediaWorkspaceSummary
            accountInfo={accountInfo}
            totalUrls={totalUrls}
            newMediaCount={newMediaCount}
          />

          <MediaWorkspaceToolbar
            fetchedMediaType={fetchedMediaType}
            totalUrls={totalUrls}
            mediaCounts={view.mediaCounts}
            sortBy={view.sortBy}
            onSortByChange={view.setSortBy}
            filterType={view.filterType}
            onFilterTypeChange={view.setFilterType}
            viewMode={view.viewMode}
            onViewModeChange={view.setViewMode}
            folderExists={actions.folderExists}
            ffmpegInstalled={actions.ffmpegInstalled}
            gifsFolderHasMP4={actions.gifsFolderHasMP4}
            isConverting={actions.isConverting}
            isDownloading={actions.isDownloading}
            selectedCount={view.selectedItems.size}
            filteredCount={view.filteredTimeline.length}
            allFilteredSelected={
              view.selectedItems.size === view.filteredTimeline.length &&
              view.filteredTimeline.length > 0
            }
            onToggleSelectAll={view.toggleSelectAll}
            onOpenFolder={actions.handleOpenFolder}
            onConvertGifs={actions.handleConvertGifs}
            onDownload={handleBulkDownload}
          />

          {view.viewMode === "list" ? (
            <MediaWorkspaceListView
              indexedTimeline={view.indexedTimeline}
              selectedItems={view.selectedItems}
              downloadedItems={actions.downloadedItems}
              failedItems={actions.failedItems}
              skippedItems={actions.skippedItems}
              downloadingItem={actions.downloadingItem}
              onToggleItem={view.toggleItem}
              onOpenPreview={view.openPreview}
              onSingleDownload={actions.handleSingleMediaDownload}
              onOpenTweet={actions.handleOpenTweet}
            />
          ) : (
            <MediaWorkspaceGalleryView
              items={view.visibleTimeline}
              selectedItems={view.selectedItems}
              downloadedItems={actions.downloadedItems}
              failedItems={actions.failedItems}
              skippedItems={actions.skippedItems}
              downloadingItem={actions.downloadingItem}
              loadMoreRef={view.loadMoreRef}
              hasMore={view.visibleCount < view.filteredTimeline.length}
              getItemKey={getTimelineItemKey}
              onToggleItem={view.toggleItem}
              onOpenPreview={view.openPreview}
              onSingleDownload={actions.handleSingleMediaDownload}
              onOpenTweet={actions.handleOpenTweet}
            />
          )}
        </div>
      </div>

      {previewItem && view.previewIndex !== null ? (
        <MediaPreviewOverlay
          item={previewItem}
          previewIndex={view.previewIndex}
          totalItems={view.filteredTimeline.length}
          canGoPrevious={view.previewIndex > 0}
          canGoNext={view.previewIndex < view.filteredTimeline.length - 1}
          downloadingItem={actions.downloadingItem === previewItemKey}
          downloadStatus={previewDownloadStatus}
          onClose={view.closePreview}
          onPrevious={view.goToPrevious}
          onNext={view.goToNext}
          onDownload={() =>
            previewItemKey
              ? actions.handleSingleMediaDownload(previewItem, previewItemKey)
              : Promise.resolve()
          }
          onOpenTweet={() => actions.handleOpenTweet(previewItem.tweet_id)}
        />
      ) : null}

      {view.showScrollTop && view.previewIndex === null ? (
        <Button
          variant="default"
          size="icon"
          className="fixed bottom-6 left-1/2 z-30 h-9 w-9 -translate-x-1/2 rounded-full shadow-lg"
          onClick={view.scrollToTop}
          aria-label="Scroll to top"
        >
          <ArrowUp className="h-4 w-4" />
        </Button>
      ) : null}
    </div>
  );
}
