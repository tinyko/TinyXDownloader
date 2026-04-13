import { ChevronLeft, ChevronRight, ExternalLink, Heart } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import type { TimelineEntry } from "@/types/api";
import {
  formatDate,
  formatNumberWithComma,
  getDownloadStatusIcon,
  getMediaWorkspaceStats,
  getPreviewUrl,
  getRelativeTime,
} from "@/lib/media/utils";

interface MediaPreviewOverlayProps {
  item: TimelineEntry;
  previewIndex: number;
  totalItems: number;
  canGoPrevious: boolean;
  canGoNext: boolean;
  downloadingItem: boolean;
  downloadStatus: "downloaded" | "failed" | "skipped" | "idle";
  onClose: () => void;
  onPrevious: () => void;
  onNext: () => void;
  onDownload: () => void | Promise<void>;
  onOpenTweet: () => void;
}

export function MediaPreviewOverlay({
  item,
  previewIndex,
  totalItems,
  canGoPrevious,
  canGoNext,
  downloadingItem,
  downloadStatus,
  onClose,
  onPrevious,
  onNext,
  onDownload,
  onOpenTweet,
}: MediaPreviewOverlayProps) {
  const StatusIcon = getDownloadStatusIcon(downloadStatus);

  return (
    <div
      className="fixed inset-0 z-40 flex flex-col items-center justify-center bg-black/80 pt-8"
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      {canGoPrevious ? (
        <Button
          variant="ghost"
          size="icon"
          className="absolute left-4 top-1/2 z-10 h-12 w-12 -translate-y-1/2 text-white hover:bg-white/20"
          onClick={onPrevious}
          aria-label="Show previous media item"
        >
          <ChevronLeft className="h-8 w-8" />
        </Button>
      ) : null}

      <div className="mb-4 rounded-full bg-black/50 px-4 py-1.5 text-sm text-white">
        {formatNumberWithComma(previewIndex + 1)} / {formatNumberWithComma(totalItems)}
      </div>

      <div className="flex max-h-[70%] max-w-[90%] items-center justify-center">
        {item.type === "photo" ? (
          <img
            src={getPreviewUrl(item.url)}
            alt=""
            className="max-h-[65vh] max-w-full rounded-lg object-contain"
          />
        ) : item.type === "video" ? (
          <video src={item.url} controls autoPlay className="max-h-[65vh] max-w-full rounded-lg" />
        ) : item.type === "text" ? (
          <div className="max-w-2xl rounded-lg bg-white p-6 dark:bg-gray-800">
            <p className="whitespace-pre-wrap text-lg">{item.content || "No content"}</p>
            <p className="mt-4 text-sm text-muted-foreground">
              {formatDate(item.date)} {getRelativeTime(item.date)}
            </p>
          </div>
        ) : (
          <video src={item.url} autoPlay loop muted className="max-h-[65vh] max-w-full rounded-lg" />
        )}
      </div>

      <div className="mt-3 flex items-center gap-4 text-sm text-white/80">
        {getMediaWorkspaceStats(item).map((stat) => {
          if (!stat) {
            return null;
          }

          if (!stat.icon) {
            return (
              <span key={stat.key} className="text-white/60">
                {stat.text}
              </span>
            );
          }

          const Icon = stat.icon;
          return (
            <span
              key={stat.key}
              className={`flex items-center gap-1 ${"className" in stat && stat.className ? stat.className : ""}`}
            >
              <Icon className="h-4 w-4" />
              {stat.text}
            </span>
          );
        })}
      </div>

      <div className="z-10 mt-4 flex items-center gap-3">
        <Button
          variant="default"
          size="sm"
          className="h-9"
          onClick={onDownload}
          disabled={downloadingItem}
        >
          {downloadingItem ? (
            <Spinner className="mr-1" />
          ) : StatusIcon ? (
            <StatusIcon className="mr-1 h-4 w-4" />
          ) : (
            <Heart className="mr-1 h-4 w-4 opacity-0" />
          )}
          {downloadingItem
            ? "Downloading..."
            : downloadStatus === "skipped"
              ? "Already exists"
              : downloadStatus === "downloaded"
                ? "Downloaded"
                : downloadStatus === "failed"
                  ? "Failed"
                  : "Download"}
        </Button>
        <Button variant="secondary" size="sm" className="h-9" onClick={onOpenTweet}>
          <ExternalLink className="mr-1 h-4 w-4" />
          Open Tweet
        </Button>
      </div>

      {canGoNext ? (
        <Button
          variant="ghost"
          size="icon"
          className="absolute right-4 top-1/2 z-10 h-12 w-12 -translate-y-1/2 text-white hover:bg-white/20"
          onClick={onNext}
          aria-label="Show next media item"
        >
          <ChevronRight className="h-8 w-8" />
        </Button>
      ) : null}
    </div>
  );
}
