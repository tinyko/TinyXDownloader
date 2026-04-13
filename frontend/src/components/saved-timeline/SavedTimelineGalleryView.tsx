import { CheckCircle, Download, ExternalLink, FileCheck, XCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Spinner } from "@/components/ui/spinner";
import { cn, openExternal } from "@/lib/utils";
import type { SavedTimelineItem } from "@/types/api";
import type { IndexedTimelineItem } from "@/hooks/media/useIndexedTimelinePreview";
import {
  formatDate,
  getMediaIcon,
  getRelativeTime,
  getThumbnailUrl,
} from "@/lib/saved/timeline-helpers";

interface SavedTimelineGalleryViewProps {
  indexedItems: IndexedTimelineItem<SavedTimelineItem>[];
  selectedItems: Set<string>;
  downloadedItems: Set<string>;
  failedItems: Set<string>;
  skippedItems: Set<string>;
  downloadingItem: string | null;
  onToggleItem: (itemKey: string) => void;
  onOpenPreview: (itemKey: string) => void;
  onDownloadItem: (item: SavedTimelineItem, itemKey: string) => Promise<void> | void;
  accountUsername: string;
}

export function SavedTimelineGalleryView({
  indexedItems,
  selectedItems,
  downloadedItems,
  failedItems,
  skippedItems,
  downloadingItem,
  onToggleItem,
  onOpenPreview,
  onDownloadItem,
  accountUsername,
}: SavedTimelineGalleryViewProps) {
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
      {indexedItems.map(({ item, index, key }) => {
        const isSelected = selectedItems.has(key);
        const isItemDownloaded = downloadedItems.has(key);
        const isItemFailed = failedItems.has(key);
        const isItemSkipped = skippedItems.has(key);
        const isItemDownloading = downloadingItem === key;

        return (
          <div
            key={key}
            className={cn(
              "group relative overflow-hidden rounded-2xl border-2 transition-all",
              isSelected ? "border-primary" : "border-transparent hover:border-muted-foreground/30"
            )}
          >
            <Button
              variant="ghost"
              className="relative aspect-square h-auto w-full rounded-none bg-muted p-0 hover:bg-muted"
              onClick={() => onOpenPreview(key)}
            >
              {item.type === "photo" || item.type === "animated_gif" || item.type === "gif" ? (
                <img
                  src={getThumbnailUrl(item.url)}
                  alt=""
                  className="h-full w-full object-cover"
                  loading="lazy"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center bg-muted">
                  {getMediaIcon(item.type)}
                </div>
              )}

              <div className="absolute inset-0 flex items-center justify-center gap-2 bg-black/60 opacity-0 transition-opacity group-hover:opacity-100">
                <Button
                  size="icon"
                  variant="default"
                  className="h-8 w-8"
                  onClick={(event) => {
                    event.stopPropagation();
                    void onDownloadItem(item, key);
                  }}
                  disabled={downloadingItem !== null}
                >
                  {isItemDownloading ? (
                    <Spinner />
                  ) : isItemSkipped ? (
                    <FileCheck className="h-4 w-4" />
                  ) : isItemDownloaded ? (
                    <CheckCircle className="h-4 w-4" />
                  ) : isItemFailed ? (
                    <XCircle className="h-4 w-4" />
                  ) : (
                    <Download className="h-4 w-4" />
                  )}
                </Button>
                <Button
                  size="icon"
                  variant="outline"
                  className="h-8 w-8"
                  onClick={(event) => {
                    event.stopPropagation();
                    openExternal(`https://x.com/${accountUsername}/status/${item.tweet_id}`);
                  }}
                >
                  <ExternalLink className="h-4 w-4" />
                </Button>
              </div>

              <div className="absolute left-2 top-2" onClick={(event) => event.stopPropagation()}>
                <Checkbox
                  checked={isSelected}
                  onCheckedChange={() => onToggleItem(key)}
                  className="bg-background/80"
                />
              </div>

              <div className="absolute bottom-2 left-2 rounded bg-black/60 px-1.5 py-0.5 text-xs text-white">
                {index + 1}
              </div>
            </Button>
            <div className="p-2 text-xs text-muted-foreground">
              <div className="truncate">{formatDate(item.date)}</div>
              <div className="mt-0.5 text-[10px]">{getRelativeTime(item.date)}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
