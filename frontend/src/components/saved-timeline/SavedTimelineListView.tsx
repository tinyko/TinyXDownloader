import { CheckCircle, Download, ExternalLink, FileCheck, XCircle } from "lucide-react";

import { Badge } from "@/components/ui/badge";
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

interface SavedTimelineListViewProps {
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

export function SavedTimelineListView({
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
}: SavedTimelineListViewProps) {
  return (
    <div className="rounded-2xl border border-border/70 bg-background/40">
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
              "flex items-center gap-4 border-b border-border/60 px-4 py-3.5 transition-colors last:border-b-0",
              isSelected ? "bg-primary/6" : "hover:bg-muted/35"
            )}
          >
            <Checkbox checked={isSelected} onCheckedChange={() => onToggleItem(key)} />
            <span className="w-8 shrink-0 text-center text-sm text-muted-foreground">
              {index + 1}
            </span>
            <Button
              variant="ghost"
              className="h-16 w-16 shrink-0 overflow-hidden rounded-2xl bg-muted p-0 hover:bg-muted"
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
                <div className="flex h-full w-full items-center justify-center">
                  {getMediaIcon(item.type)}
                </div>
              )}
            </Button>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-medium">{item.tweet_id}</p>
                <Badge variant="secondary" className="text-xs">
                  {getMediaIcon(item.type)}
                </Badge>
                {isItemSkipped ? <FileCheck className="h-4 w-4 text-yellow-500" /> : null}
                {isItemDownloaded ? <CheckCircle className="h-4 w-4 text-green-500" /> : null}
                {isItemFailed ? <XCircle className="h-4 w-4 text-red-500" /> : null}
              </div>
              {item.content ? (
                <p className="mt-1 line-clamp-2 text-sm">{item.content}</p>
              ) : null}
              <p className="mt-1 text-sm text-muted-foreground">
                {formatDate(item.date)} {getRelativeTime(item.date)}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Button
                size="icon"
                variant="default"
                onClick={() => void onDownloadItem(item, key)}
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
                onClick={() => openExternal(`https://x.com/${accountUsername}/status/${item.tweet_id}`)}
              >
                <ExternalLink className="h-4 w-4" />
              </Button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
