import { useState, useEffect, useRef, useCallback, useMemo, startTransition } from "react";
import { VList } from "virtua";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

import {
  Image,
  Video,
  Film,
  FileText,
  ExternalLink,
  Repeat2,
  Download,
  FolderOpen,
  LayoutGrid,
  List,
  Users,
  UserPlus,
  MessageSquare,
  Calendar,
  ArrowUp,
  ChevronLeft,
  ChevronRight,
  Eye,
  Heart,
  Bookmark,
  BadgeCheck,
  Maximize2,
  CheckCircle,
  XCircle,
  FileCheck,
} from "lucide-react";
import { Spinner } from "@/components/ui/spinner";
import type { TimelineEntry, AccountInfo } from "@/types/api";
import type { GlobalDownloadSessionMeta, GlobalDownloadState } from "@/components/GlobalDownloadPanel";
import { getMediaItemKey, useMediaListModel } from "@/hooks/useMediaListModel";
import { logger } from "@/lib/logger";
import { toastWithSound as toast } from "@/lib/toast-with-sound";
import { getSettings } from "@/lib/settings";
import { cn } from "@/lib/utils";
import { openExternal } from "@/lib/utils";
import { DownloadMediaWithMetadata, OpenFolder, IsFFmpegInstalled, ConvertGIFs, CheckFolderExists, CheckGifsFolderHasMP4 } from "../../wailsjs/go/main/App";
import { EventsOn } from "../../wailsjs/runtime/runtime";
import { main } from "../../wailsjs/go/models";

interface DownloadItemStatus {
  tweet_id: number;
  index: number;
  status: "success" | "failed" | "skipped";
}

interface PendingItemStatuses {
  downloaded: Set<string>;
  failed: Set<string>;
  skipped: Set<string>;
}

interface MediaListProps {
  accountInfo: AccountInfo;
  timeline: TimelineEntry[];
  totalUrls: number;
  fetchedMediaType?: string;
  newMediaCount?: number | null;
  downloadState?: GlobalDownloadState | null;
  downloadMeta?: GlobalDownloadSessionMeta | null;
  onDownloadSessionStart?: (meta: GlobalDownloadSessionMeta) => void;
}

function getThumbnailUrl(url: string): string {
  // For animated_gif: video.twimg.com/tweet_video/XXX.mp4 -> pbs.twimg.com/tweet_video_thumb/XXX?format=jpg&name=360x360
  if (url.includes("video.twimg.com/tweet_video/")) {
    // Extract filename from URL (e.g., GzstJyDbIAAPuX9.mp4 -> GzstJyDbIAAPuX9)
    const match = url.match(/tweet_video\/([^/]+)\.mp4/);
    if (match && match[1]) {
      const filename = match[1];
      return `https://pbs.twimg.com/tweet_video_thumb/${filename}?format=jpg&name=360x360`;
    }
  }
  
  // For photos: pbs.twimg.com/media/XXX -> use 360x360 for consistency
  if (url.includes("pbs.twimg.com/media/")) {
    if (url.includes("?format=")) {
      if (url.includes("&name=")) {
        const parts = url.split("&name=");
        return parts[0] + "&name=360x360";
      }
      return url + "&name=360x360";
    }
    if (url.includes("?")) {
      return url + "&name=360x360";
    }
    return url + "?format=jpg&name=360x360";
  }
  return url;
}

function getPreviewUrl(url: string): string {
  // For images, use large size for preview
  if (url.includes("pbs.twimg.com/media/")) {
    if (url.includes("?format=")) {
      if (url.includes("&name=")) {
        const parts = url.split("&name=");
        return parts[0] + "&name=large";
      }
      return url + "&name=large";
    }
    if (url.includes("?")) {
      return url + "&name=large";
    }
    return url + "?format=jpg&name=large";
  }
  return url;
}

function getMediaIcon(type: string) {
  switch (type) {
    case "photo":
      return <Image className="h-4 w-4" />;
    case "video":
      return <Video className="h-4 w-4" />;
    case "gif":
    case "animated_gif":
      return <Film className="h-4 w-4" />;
    case "text":
      return <FileText className="h-4 w-4" />;
    default:
      return <Image className="h-4 w-4" />;
  }
}

function formatDate(dateStr: string): string {
  try {
    // Handle ISO format: 2022-12-30T03:21:36 -> 2022-12-30 • 03:21:36
    if (dateStr.includes("T")) {
      const [datePart, timePart] = dateStr.split("T");
      // Remove timezone if present
      const timeClean = timePart.split("+")[0].split("Z")[0];
      return `${datePart} • ${timeClean}`;
    }
    return dateStr;
  } catch {
    return dateStr;
  }
}

function getRelativeTime(dateStr: string): string {
  try {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    
    const diffMinutes = Math.floor(diffMs / (1000 * 60));
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    const diffMonths = Math.floor(diffDays / 30);
    const diffYears = Math.floor(diffDays / 365);
    
    if (diffYears > 0) {
      const remainingMonths = Math.floor((diffDays % 365) / 30);
      return `(${diffYears}y ${remainingMonths}m ago)`;
    } else if (diffMonths > 0) {
      const remainingDays = diffDays % 30;
      return `(${diffMonths}m ${remainingDays}d ago)`;
    } else if (diffDays > 0) {
      const remainingHours = diffHours % 24;
      return `(${diffDays}d ${remainingHours}h ago)`;
    } else if (diffHours > 0) {
      const remainingMinutes = diffMinutes % 60;
      return `(${diffHours}h ${remainingMinutes}m ago)`;
    } else if (diffMinutes > 0) {
      return `(${diffMinutes}m ago)`;
    } else {
      return "(just now)";
    }
  } catch {
    return "";
  }
}

function formatNumber(num: number): string {
  if (num >= 1000000) {
    return (num / 1000000).toFixed(1) + "M";
  }
  if (num >= 1000) {
    return (num / 1000).toFixed(1) + "K";
  }
  return num.toString();
}

function formatNumberWithComma(num: number): string {
  return num.toLocaleString();
}

function formatJoinDate(dateStr: string): string {
  try {
    const date = new Date(dateStr);
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    return `${months[date.getMonth()]} ${date.getFullYear()}`;
  } catch {
    return dateStr;
  }
}

export function MediaList({
  accountInfo,
  timeline,
  totalUrls,
  fetchedMediaType = "all",
  newMediaCount = null,
  downloadState = null,
  downloadMeta = null,
  onDownloadSessionStart,
}: MediaListProps) {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const [sortBy, setSortBy] = useState<string>("date-desc");
  const [filterType, setFilterType] = useState<string>("all");
  const [viewMode, setViewMode] = useState<"gallery" | "list">("list");
  const [hasDownloaded, setHasDownloaded] = useState(false);
  const [isConverting, setIsConverting] = useState(false);
  const [ffmpegInstalled, setFfmpegInstalled] = useState(false);
  const [showScrollTop, setShowScrollTop] = useState(false);
  const [folderExists, setFolderExists] = useState(false);
  const [gifsFolderHasMP4, setGifsFolderHasMP4] = useState(false);
  const [previewKey, setPreviewKey] = useState<string | null>(null);
  // Download status tracking per item (by tweet_id + index for uniqueness)
  const [downloadedItems, setDownloadedItems] = useState<Set<string>>(new Set());
  const [failedItems, setFailedItems] = useState<Set<string>>(new Set());
  const [skippedItems, setSkippedItems] = useState<Set<string>>(new Set());
  const [downloadingItem, setDownloadingItem] = useState<string | null>(null);
  // Lazy loading: start with 10 thumbnails, load more on scroll
  const [visibleCount, setVisibleCount] = useState<number>(10);
  const loadMoreRef = useRef<HTMLDivElement>(null);
  const { mediaCounts, filteredTimeline, indexedTimeline, timelineIndexByKey } = useMediaListModel(
    timeline,
    filterType,
    sortBy
  );
  const accountFolderName = useMemo(() => {
    if (accountInfo.nick === "My Bookmarks" || accountInfo.name === "bookmarks") {
      return "My Bookmarks";
    }
    if (accountInfo.nick === "My Likes" || accountInfo.name === "likes") {
      return "My Likes";
    }
    return accountInfo.name;
  }, [accountInfo.name, accountInfo.nick]);
  const previewIndex = previewKey ? timelineIndexByKey.get(previewKey) ?? null : null;
  const isDownloading = Boolean(
    downloadState?.in_progress &&
      downloadMeta?.source === "media-list" &&
      downloadMeta.targetKey === accountInfo.name
  );

  // Listen for scroll to show/hide scroll-to-top button
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

  // Reset visible count when filtered timeline changes
  useEffect(() => {
    setVisibleCount(10);
  }, [filteredTimeline.length]);

  // Check folder existence and FFmpeg installation
  useEffect(() => {
    let active = true;

    const checkFoldersAndFFmpeg = async () => {
      const settings = getSettings();
      const basePath = settings.downloadPath;

      const installed = await IsFFmpegInstalled();
      if (!active) {
        return;
      }
      setFfmpegInstalled(installed);

      if (!basePath || !accountFolderName) {
        if (active) {
          setFolderExists(false);
          setGifsFolderHasMP4(false);
        }
        return;
      }

      const exists = await CheckFolderExists(basePath, accountFolderName);
      if (!active) {
        return;
      }
      setFolderExists(exists);

      if (!exists) {
        setGifsFolderHasMP4(false);
        return;
      }

      const hasMP4 = await CheckGifsFolderHasMP4(basePath, accountFolderName);
      if (!active) {
        return;
      }
      setGifsFolderHasMP4(hasMP4);
    };

    void checkFoldersAndFFmpeg();

    return () => {
      active = false;
    };
  }, [accountFolderName, hasDownloaded]);

  // Intersection Observer for lazy loading thumbnails
  useEffect(() => {
    if (!loadMoreRef.current) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          setVisibleCount((prev) => {
            // Load 10 more items at a time
            const filteredLength = filteredTimeline.length;
            return Math.min(prev + 10, filteredLength);
          });
        }
      },
      { threshold: 0.1 }
    );

    const currentLoadMoreRef = loadMoreRef.current;
    observer.observe(currentLoadMoreRef);

    return () => {
      if (currentLoadMoreRef) {
        observer.unobserve(currentLoadMoreRef);
      }
    };
  }, [filteredTimeline.length]);

  const scrollToTop = () => {
    scrollContainerRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  };

  const openPreview = (itemKey: string) => {
    setPreviewKey(itemKey);
  };

  const closePreview = useCallback(() => {
    setPreviewKey(null);
  }, []);

  // Lock body scroll when preview is open
  useEffect(() => {
    if (previewIndex !== null) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [previewIndex, previewKey]);

  // Listen for per-item download status events
  // Store current downloading item key for event listener (single download)
  const currentDownloadingItemKeyRef = useRef<string | null>(null);
  // Store mapping from backend index to itemKey for bulk download
  const bulkDownloadKeyMapRef = useRef<Map<number, string>>(new Map());
  const pendingItemStatusesRef = useRef<PendingItemStatuses>({
    downloaded: new Set(),
    failed: new Set(),
    skipped: new Set(),
  });
  const flushItemStatusesTimerRef = useRef<number | null>(null);

  const flushPendingItemStatuses = useCallback(() => {
    flushItemStatusesTimerRef.current = null;

    const pending = pendingItemStatusesRef.current;
    if (
      pending.downloaded.size === 0 &&
      pending.failed.size === 0 &&
      pending.skipped.size === 0
    ) {
      return;
    }

    pendingItemStatusesRef.current = {
      downloaded: new Set(),
      failed: new Set(),
      skipped: new Set(),
    };

    const downloaded = Array.from(pending.downloaded);
    const failed = Array.from(pending.failed);
    const skipped = Array.from(pending.skipped);

    startTransition(() => {
      if (downloaded.length > 0) {
        setDownloadedItems((prev) => {
          const next = new Set(prev);
          for (const itemKey of downloaded) {
            next.add(itemKey);
          }
          return next;
        });
      }

      if (failed.length > 0) {
        setFailedItems((prev) => {
          const next = new Set(prev);
          for (const itemKey of failed) {
            next.add(itemKey);
          }
          return next;
        });
      }

      if (skipped.length > 0) {
        setDownloadedItems((prev) => {
          const next = new Set(prev);
          for (const itemKey of skipped) {
            next.delete(itemKey);
          }
          return next;
        });
        setSkippedItems((prev) => {
          const next = new Set(prev);
          for (const itemKey of skipped) {
            next.add(itemKey);
          }
          return next;
        });
      }
    });
  }, []);

  const schedulePendingItemStatusFlush = useCallback(() => {
    if (flushItemStatusesTimerRef.current !== null) {
      return;
    }
    flushItemStatusesTimerRef.current = window.setTimeout(() => {
      flushPendingItemStatuses();
    }, 60);
  }, [flushPendingItemStatuses]);

  useEffect(() => {
    const unsubscribe = EventsOn("download-item-status", (status: DownloadItemStatus) => {
      // For single download, use the current downloading item key directly
      const currentKey = currentDownloadingItemKeyRef.current;
      // For bulk download, use key mapping
      const keyMap = bulkDownloadKeyMapRef.current;
      
      let itemKey: string;
      if (currentKey) {
        // Single download - use the stored key
        itemKey = currentKey;
      } else if (keyMap.size > 0) {
        // Bulk download - map backend index to itemKey
        itemKey = keyMap.get(status.index) ?? `${String(status.tweet_id)}-${status.index}`;
      } else {
        // Fallback
        itemKey = `${String(status.tweet_id)}-${status.index}`;
      }
      
      if (status.status === "success") {
        pendingItemStatusesRef.current.downloaded.add(itemKey);
        pendingItemStatusesRef.current.failed.delete(itemKey);
        pendingItemStatusesRef.current.skipped.delete(itemKey);
        schedulePendingItemStatusFlush();
        // Show toast for single download
        if (currentKey) {
          toast.success("Downloaded");
        }
      } else if (status.status === "failed") {
        pendingItemStatusesRef.current.failed.add(itemKey);
        pendingItemStatusesRef.current.downloaded.delete(itemKey);
        pendingItemStatusesRef.current.skipped.delete(itemKey);
        schedulePendingItemStatusFlush();
        if (currentKey) {
          toast.error("Download failed");
        }
      } else if (status.status === "skipped") {
        pendingItemStatusesRef.current.skipped.add(itemKey);
        pendingItemStatusesRef.current.downloaded.delete(itemKey);
        pendingItemStatusesRef.current.failed.delete(itemKey);
        schedulePendingItemStatusFlush();
        // Show toast for single download
        if (currentKey) {
          toast.info("Already exists");
        }
      }
    });
    return () => {
      if (flushItemStatusesTimerRef.current !== null) {
        window.clearTimeout(flushItemStatusesTimerRef.current);
        flushItemStatusesTimerRef.current = null;
      }
      unsubscribe();
    };
  }, [flushPendingItemStatuses, schedulePendingItemStatusFlush]);

  const goToPrevious = useCallback(() => {
    if (previewIndex !== null && previewIndex > 0) {
      setPreviewKey(indexedTimeline[previewIndex - 1].key);
    }
  }, [indexedTimeline, previewIndex]);

  const goToNext = useCallback(() => {
    if (previewIndex !== null && previewIndex < filteredTimeline.length - 1) {
      setPreviewKey(indexedTimeline[previewIndex + 1].key);
    }
  }, [filteredTimeline.length, indexedTimeline, previewIndex]);

  // Handle keyboard navigation for preview
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (previewIndex === null) return;
      if (e.key === "ArrowLeft") goToPrevious();
      if (e.key === "ArrowRight") goToNext();
      if (e.key === "Escape") closePreview();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [closePreview, goToNext, goToPrevious, previewIndex]);

  // Count media types
  const toggleSelectAll = () => {
    if (selectedItems.size === filteredTimeline.length) {
      setSelectedItems(new Set());
    } else {
      setSelectedItems(new Set(indexedTimeline.map((entry) => entry.key)));
    }
  };

  const toggleItem = (itemKey: string) => {
    const newSelected = new Set(selectedItems);
    if (newSelected.has(itemKey)) {
      newSelected.delete(itemKey);
    } else {
      newSelected.add(itemKey);
    }
    setSelectedItems(newSelected);
  };

  // Helper function to get output directory (adds "My Bookmarks" or "My Likes" folder)
  const getOutputDir = useCallback((): string => {
    const settings = getSettings();
    const isBookmarks = accountInfo.nick === "My Bookmarks";
    const isLikes = accountInfo.nick === "My Likes";
    if (isBookmarks || isLikes) {
      // Use path separator that backend will normalize (filepath.Join handles both / and \)
      const separator = settings.downloadPath.includes("/") ? "/" : "\\";
      const folderName = isBookmarks ? "My Bookmarks" : "My Likes";
      return `${settings.downloadPath}${separator}${folderName}`;
    }
    return settings.downloadPath;
  }, [accountInfo.nick]);

  const handleDownload = async () => {
    const itemsWithIndices =
      selectedItems.size > 0
        ? indexedTimeline
            .filter((entry) => selectedItems.has(entry.key))
            .map((entry) => ({ item: entry.item, originalIndex: entry.index }))
        : indexedTimeline.map((entry) => ({
            item: entry.item,
            originalIndex: entry.index,
          }));

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

    // Create mapping from backend index to itemKey for bulk download
    const keyMap = new Map<number, string>();
    itemsWithIndices.forEach((entry, backendIndex) => {
      keyMap.set(backendIndex, getMediaItemKey(entry.item));
    });
    bulkDownloadKeyMapRef.current = keyMap;

    logger.info(`Starting download of ${itemsWithIndices.length} files...`);

    try {
      const settings = getSettings();
      const request = new main.DownloadMediaWithMetadataRequest({
        items: itemsWithIndices.map(({ item }) => new main.MediaItemRequest({
          url: item.url,
          date: item.date,
          tweet_id: item.tweet_id,
          type: item.type,
          content: item.content || "",
          original_filename: item.original_filename || "",
          author_username: item.author_username || "",
        })),
        output_dir: getOutputDir(),
        username: accountInfo.name,
        proxy: settings.proxy || "",
      });
      const response = await DownloadMediaWithMetadata(request);

      if (response.success) {
        const parts: string[] = [];
        if (response.downloaded > 0) {
          parts.push(`${response.downloaded} file${response.downloaded !== 1 ? 's' : ''} downloaded`);
        }
        if (response.skipped > 0) {
          parts.push(`${response.skipped} file${response.skipped !== 1 ? 's' : ''} already exist${response.skipped !== 1 ? '' : 's'}`);
        }
        if (response.failed > 0) {
          parts.push(`${response.failed} failed`);
        }
        const message = parts.length > 0 ? parts.join(', ') : 'Download completed';
        
        // Use info toast if only skipped files (no downloaded, no failed)
        if (response.downloaded === 0 && response.failed === 0 && response.skipped > 0) {
          logger.info(message);
          toast.info(message);
        } else {
          logger.success(message);
          toast.success(message);
        }
        setHasDownloaded(true);
        
        // Check if FFmpeg is installed for GIF conversion
        const installed = await IsFFmpegInstalled();
        setFfmpegInstalled(installed);
      } else {
        logger.error(response.message);
        toast.error("Download failed");
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error(`Download failed: ${errorMsg}`);
      toast.error("Download failed");
    } finally {
      bulkDownloadKeyMapRef.current = new Map();
    }
  };

  const handleOpenFolder = async () => {
    const settings = getSettings();
    const isBookmarks = accountInfo.nick === "My Bookmarks";
    const isLikes = accountInfo.nick === "My Likes";
    
    // Build path - for bookmarks/likes, use the folder structure
    let folderPath: string;
    if (isBookmarks || isLikes) {
      const separator = settings.downloadPath.includes("/") ? "/" : "\\";
      const folderName = isBookmarks ? "My Bookmarks" : "My Likes";
      folderPath = settings.downloadPath 
        ? `${settings.downloadPath}${separator}${folderName}`
        : folderName;
    } else {
      folderPath = settings.downloadPath 
        ? `${settings.downloadPath}/${accountInfo.name}`
        : accountInfo.name;
    }
    
    try {
      await OpenFolder(folderPath);
    } catch {
      try {
        await OpenFolder(settings.downloadPath);
      } catch {
        toast.error("Could not open folder");
      }
    }
  };

  const handleOpenTweet = (tweetId: string) => {
    openExternal(`https://x.com/${accountInfo.name}/status/${tweetId}`);
  };

  const handleConvertGifs = async () => {
    const settings = getSettings();
    const isBookmarks = accountInfo.nick === "My Bookmarks";
    const isLikes = accountInfo.nick === "My Likes";
    
    // Build path - for bookmarks/likes, use the folder structure
    let folderPath: string;
    if (isBookmarks || isLikes) {
      const separator = settings.downloadPath.includes("/") ? "/" : "\\";
      const folderName = isBookmarks ? "My Bookmarks" : "My Likes";
      folderPath = `${settings.downloadPath}${separator}${folderName}`;
    } else {
      folderPath = `${settings.downloadPath}/${accountInfo.name}`;
    }

    setIsConverting(true);
    logger.info("Converting GIFs...");

    try {
      const response = await ConvertGIFs({
        folder_path: folderPath,
        quality: settings.gifQuality || "fast",
        resolution: settings.gifResolution || "high",
        delete_original: false, // Keep MP4 original
      });

      if (response.success) {
        logger.success(`Converted ${response.converted} GIFs`);
        toast.success(`${response.converted} GIFs converted`);
        // Re-check if gifs folder still has MP4 files after conversion
        const settings = getSettings();
        let folderName = accountInfo.name;
        if (accountInfo.nick === "My Bookmarks" || accountInfo.name === "bookmarks") {
          folderName = "My Bookmarks";
        } else if (accountInfo.nick === "My Likes" || accountInfo.name === "likes") {
          folderName = "My Likes";
        }
        const hasMP4 = await CheckGifsFolderHasMP4(settings.downloadPath, folderName);
        setGifsFolderHasMP4(hasMP4);
      } else {
        logger.error(response.message);
        toast.error("Convert failed");
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error(`Convert failed: ${errorMsg}`);
      toast.error("Convert failed");
    } finally {
      setIsConverting(false);
    }
  };

  const handleSingleMediaDownload = useCallback(
    async (item: TimelineEntry, itemKey: string) => {
      setDownloadingItem(itemKey);
      currentDownloadingItemKeyRef.current = itemKey;

      try {
        const settings = getSettings();
        const request = new main.DownloadMediaWithMetadataRequest({
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
          username: accountInfo.name,
          proxy: settings.proxy || "",
        });

        const response = await DownloadMediaWithMetadata(request);
        if (response.success) {
          setHasDownloaded(true);
          return;
        }

        setFailedItems((prev) => new Set(prev).add(itemKey));
        toast.error(response.message || "Download failed");
      } catch (error) {
        setFailedItems((prev) => new Set(prev).add(itemKey));
        const errorMsg = error instanceof Error ? error.message : String(error);
        toast.error(`Download failed: ${errorMsg}`);
      } finally {
        setDownloadingItem(null);
        window.setTimeout(() => {
          currentDownloadingItemKeyRef.current = null;
        }, 1000);
      }
    },
    [accountInfo.name, getOutputDir]
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div ref={scrollContainerRef} className="min-h-0 flex-1 overflow-y-auto pr-1">
        <div className="space-y-4 pb-4">
          {/* Account Info Card */}
          {accountInfo.name === "bookmarks" || accountInfo.name === "likes" ? (
        // Bookmarks/Likes mode - simple card without account info
        <div className="flex items-center gap-3 rounded-lg bg-muted/50 p-3">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
            {accountInfo.name === "bookmarks" ? (
              <Bookmark className="h-8 w-8 text-primary" />
            ) : (
              <Heart className="h-8 w-8 text-primary" />
            )}
          </div>
          <div className="flex-1">
            <h2 className="text-lg font-semibold">{accountInfo.nick}</h2>
          </div>
          <div className="text-right">
            <div className="flex items-center justify-end gap-2">
              {newMediaCount !== null && newMediaCount > 0 && (
                <div className="text-lg font-semibold text-green-600 dark:text-green-400 animate-in fade-in slide-in-from-left-2 duration-300">
                  {formatNumberWithComma(newMediaCount)}+
                </div>
              )}
              <div className="text-xl font-bold text-primary">{formatNumberWithComma(totalUrls)}</div>
            </div>
            <div className="text-xs text-muted-foreground">items found</div>
          </div>
        </div>
      ) : (
        // Normal account info card
        <div className="flex items-center gap-3 rounded-lg bg-muted/50 p-3">
          <img
            src={accountInfo.profile_image}
            alt={accountInfo.nick}
            className="h-14 w-14 rounded-full"
          />
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <h2 className="text-lg">{accountInfo.nick}</h2>
              <span className="text-sm text-muted-foreground">@{accountInfo.name}</span>
            </div>
            <div className="mt-1 flex items-center gap-3 text-xs text-muted-foreground">
              <span className="flex items-center gap-1">
                <Users className="h-3.5 w-3.5" />
                {formatNumber(accountInfo.followers_count)} followers
              </span>
              <span className="flex items-center gap-1">
                <UserPlus className="h-3.5 w-3.5" />
                {formatNumber(accountInfo.friends_count)} following
              </span>
              <span className="flex items-center gap-1">
                <MessageSquare className="h-3.5 w-3.5" />
                {formatNumber(accountInfo.statuses_count)} posts
              </span>
              {accountInfo.date && (
                <span className="flex items-center gap-1">
                  <Calendar className="h-3.5 w-3.5" />
                  Joined {formatJoinDate(accountInfo.date)}
                </span>
              )}
            </div>
          </div>
          <div className="text-right">
            <div className="flex items-center justify-end gap-2">
              {newMediaCount !== null && newMediaCount > 0 && (
                <div className="text-lg font-semibold text-green-600 dark:text-green-400 animate-in fade-in slide-in-from-left-2 duration-300">
                  {formatNumberWithComma(newMediaCount)}+
                </div>
              )}
              <div className="text-xl font-bold text-primary">{formatNumberWithComma(totalUrls)}</div>
            </div>
            <div className="text-xs text-muted-foreground">items found</div>
          </div>
        </div>
      )}

      {/* Controls */}
          <div className="flex flex-wrap items-center gap-2">
        <Select value={sortBy} onValueChange={setSortBy}>
          <SelectTrigger className="h-9 w-auto rounded-xl px-3 text-sm">
            <SelectValue placeholder="Sort by" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="date-desc">Newest</SelectItem>
            <SelectItem value="date-asc">Oldest</SelectItem>
          </SelectContent>
        </Select>

        {/* Filter - only show when fetched "all" media types */}
        {fetchedMediaType === "all" && (
          <Select value={filterType} onValueChange={setFilterType}>
            <SelectTrigger className="h-9 w-auto rounded-xl px-3 text-sm">
              <SelectValue placeholder="Filter" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All ({formatNumberWithComma(totalUrls)})</SelectItem>
              {mediaCounts.photo > 0 && (
                <SelectItem value="photo">
                  <span className="flex items-center gap-2">
                    <Image className="h-4 w-4 text-blue-500" />
                    Images ({formatNumberWithComma(mediaCounts.photo)})
                  </span>
                </SelectItem>
              )}
              {mediaCounts.video > 0 && (
                <SelectItem value="video">
                  <span className="flex items-center gap-2">
                    <Video className="h-4 w-4 text-purple-500" />
                    Videos ({formatNumberWithComma(mediaCounts.video)})
                  </span>
                </SelectItem>
              )}
              {mediaCounts.gif > 0 && (
                <SelectItem value="gif">
                  <span className="flex items-center gap-2">
                    <Film className="h-4 w-4 text-green-500" />
                    GIFs ({formatNumberWithComma(mediaCounts.gif)})
                  </span>
                </SelectItem>
              )}
            </SelectContent>
          </Select>
        )}

        {/* View Mode Toggle */}
        <div className="flex items-center rounded-xl border">
          <Button
            variant={viewMode === "gallery" ? "secondary" : "ghost"}
            size="icon"
            className="h-9 w-9 rounded-r-none"
            onClick={() => setViewMode("gallery")}
            aria-label="Show gallery view"
          >
            <LayoutGrid className="h-4 w-4" />
          </Button>
          <Button
            variant={viewMode === "list" ? "secondary" : "ghost"}
            size="icon"
            className="h-9 w-9 rounded-l-none border-l"
            onClick={() => setViewMode("list")}
            aria-label="Show list view"
          >
            <List className="h-4 w-4" />
          </Button>
        </div>

        <div className="flex-1" />
        <Button
          variant="outline"
          className="h-9 rounded-xl px-3 text-sm"
          onClick={handleOpenFolder}
          disabled={!folderExists}
        >
          <FolderOpen className="h-4 w-4" />
          Open Folder
        </Button>
        <Button
          variant="outline"
          className="h-9 rounded-xl px-3 text-sm"
          onClick={handleConvertGifs}
          disabled={isConverting || !gifsFolderHasMP4 || !ffmpegInstalled}
        >
          {isConverting ? (
            <>
              <Spinner />
              Converting...
            </>
          ) : (
            <>
              <Film className="h-4 w-4" />
              Convert GIFs
            </>
          )}
        </Button>
        <Button
          className="h-9 rounded-xl px-3 text-sm"
          onClick={handleDownload}
          disabled={isDownloading}
        >
          <Download className="h-4 w-4" />
          Download {selectedItems.size > 0 ? `${selectedItems.size}` : "All"}
        </Button>
          </div>

          {/* Select All */}
          <div className="flex items-center gap-2">
            <Checkbox
              checked={selectedItems.size === filteredTimeline.length && filteredTimeline.length > 0}
              onCheckedChange={toggleSelectAll}
            />
            <span className="text-xs text-muted-foreground">
              Select all ({formatNumberWithComma(filteredTimeline.length)} items)
            </span>
            {selectedItems.size > 0 && (
              <Badge variant="secondary">{formatNumberWithComma(selectedItems.size)} selected</Badge>
            )}
          </div>

          {/* Media Grid/List */}
          {viewMode === "list" ? (
            <VList
              data={indexedTimeline}
              style={{ height: "72vh" }}
              className="rounded-2xl border border-border/70 bg-background/40"
            >
          {(entry) => {
            const { item, index, key: itemKey } = entry;
            const isSelected = selectedItems.has(itemKey);
            const isItemDownloaded = downloadedItems.has(itemKey);
            const isItemFailed = failedItems.has(itemKey);
            const isItemSkipped = skippedItems.has(itemKey);
            const isItemDownloading = downloadingItem === itemKey;

            return (
              <div
                key={itemKey}
                className={cn(
                  "flex items-center gap-4 border-b border-border/60 px-4 py-3.5 transition-colors",
                  isSelected ? "bg-primary/6" : "hover:bg-muted/35"
                )}
              >
                <Checkbox
                  checked={isSelected}
                  onCheckedChange={() => toggleItem(itemKey)}
                />
                <span className="w-8 shrink-0 text-center text-sm text-muted-foreground">
                  {index + 1}
                </span>
                <Button
                  variant="ghost"
                  className="h-16 w-16 shrink-0 overflow-hidden rounded-2xl bg-muted p-0 hover:bg-muted"
                  onClick={() => openPreview(itemKey)}
                  aria-label={`Open preview for ${item.tweet_id}`}
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
                    <Badge
                      variant="secondary"
                      className={cn(
                        "text-xs",
                        item.type === "photo" && "bg-blue-500/20 text-blue-700 dark:text-blue-300",
                        item.type === "video" && "bg-purple-500/20 text-purple-700 dark:text-purple-300",
                        item.type === "text" && "bg-orange-500/20 text-orange-700 dark:text-orange-300",
                        (item.type === "gif" || item.type === "animated_gif") &&
                          "bg-green-500/20 text-green-700 dark:text-green-300"
                      )}
                    >
                      {getMediaIcon(item.type)}
                    </Badge>
                    {item.is_retweet ? (
                      <Badge variant="outline" className="text-xs px-1.5">
                        <Repeat2 className="h-3 w-3" />
                      </Badge>
                    ) : null}
                    {isItemSkipped ? (
                      <FileCheck className="h-4 w-4 shrink-0 text-yellow-500" />
                    ) : isItemDownloaded ? (
                      <CheckCircle className="h-4 w-4 shrink-0 text-green-500" />
                    ) : isItemFailed ? (
                      <XCircle className="h-4 w-4 shrink-0 text-red-500" />
                    ) : null}
                  </div>
                  {item.type === "text" && item.content ? (
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
                    aria-label={`Download media ${item.tweet_id}`}
                    onClick={() => handleSingleMediaDownload(item, itemKey)}
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
                    aria-label={`Open tweet ${item.tweet_id} on X`}
                    onClick={() => handleOpenTweet(item.tweet_id)}
                  >
                    <ExternalLink className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            );
          }}
            </VList>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {filteredTimeline.slice(0, visibleCount).map((item, index) => {
            const itemKey = getMediaItemKey(item);
            const isSelected = selectedItems.has(itemKey);
            const isItemDownloaded = downloadedItems.has(itemKey);
            const isItemFailed = failedItems.has(itemKey);
            const isItemSkipped = skippedItems.has(itemKey);
            const isItemDownloading = downloadingItem === itemKey;

            return (
              <div
                key={itemKey}
                className={`relative group overflow-hidden rounded-2xl border-2 transition-all ${
                  isSelected ? "border-primary" : "border-transparent hover:border-muted-foreground/30"
                }`}
                style={{ contentVisibility: "auto", containIntrinsicSize: "280px" }}
              >
                {/* Thumbnail */}
                <Button
                  variant="ghost"
                  className="relative aspect-square h-auto w-full rounded-none bg-muted p-0 hover:bg-muted"
                  onClick={() => openPreview(itemKey)}
                  aria-label={`Open preview for ${item.tweet_id}`}
                >
                  {item.type === "photo" || item.type === "animated_gif" || item.type === "gif" ? (
                    <img
                      src={getThumbnailUrl(item.url)}
                      alt=""
                      className="w-full h-full object-cover"
                      loading="lazy"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center bg-muted">
                      {getMediaIcon(item.type)}
                    </div>
                  )}

                  {/* Overlay */}
                  <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          size="icon"
                          variant="default"
                        className="h-8 w-8"
                        aria-label={`Download media ${item.tweet_id}`}
                        onClick={async (e) => {
                          e.stopPropagation();
                          await handleSingleMediaDownload(item, itemKey);
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
                      </TooltipTrigger>
                      <TooltipContent>
                        {isItemDownloading ? (
                          <p>Downloading...</p>
                        ) : isItemSkipped ? (
                          <p>Already exists</p>
                        ) : isItemDownloaded ? (
                          <p>Downloaded</p>
                        ) : isItemFailed ? (
                          <p>Failed</p>
                        ) : (
                          <p>Download</p>
                        )}
                      </TooltipContent>
                    </Tooltip>
                    <Button
                      size="icon"
                      variant="outline"
                      className="h-8 w-8"
                      aria-label={`Open tweet ${item.tweet_id} on X`}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleOpenTweet(item.tweet_id);
                      }}
                    >
                      <ExternalLink className="h-4 w-4" />
                    </Button>
                  </div>

                  {/* Checkbox */}
                  <div className="absolute top-2 left-2" onClick={(e) => e.stopPropagation()}>
                    <Checkbox
                      checked={isSelected}
                      onCheckedChange={() => toggleItem(itemKey)}
                      className="bg-background/80"
                    />
                  </div>

                  {/* Type Badge */}
                  <div className="absolute top-2 right-2">
                    <Badge 
                      variant="secondary" 
                      className={`text-xs px-1.5 py-0.5 ${
                        item.type === "photo" 
                          ? "bg-blue-500/20 text-blue-700 dark:text-blue-300" 
                          : item.type === "video" 
                          ? "bg-purple-500/20 text-purple-700 dark:text-purple-300"
                          : item.type === "text"
                          ? "bg-orange-500/20 text-orange-700 dark:text-orange-300"
                          : "bg-green-500/20 text-green-700 dark:text-green-300"
                      }`}
                    >
                      {getMediaIcon(item.type)}
                    </Badge>
                  </div>

                  {/* Retweet indicator */}
                  {item.is_retweet && (
                    <div className="absolute bottom-2 right-2">
                      <Badge variant="outline" className="text-xs px-1.5 py-0.5 bg-background/80">
                        <Repeat2 className="h-3 w-3" />
                      </Badge>
                    </div>
                  )}

                  {/* Number badge - bottom left inside thumbnail */}
                  <div className="absolute bottom-2 left-2">
                    <span className="text-xs px-1.5 py-0.5 bg-black/60 text-white rounded">
                      {index + 1}
                    </span>
                  </div>
                </Button>

                {/* Info */}
                <div className="p-2 text-xs text-muted-foreground">
                  <div className="truncate">{formatDate(item.date)}</div>
                  <div className="text-[10px] mt-0.5">{getRelativeTime(item.date)}</div>
                </div>
              </div>
            );
          })}
        </div>
          )}

          {/* Sentinel for lazy loading - only show if there are more items to load */}
          {viewMode === "gallery" && visibleCount < filteredTimeline.length && (
            <div ref={loadMoreRef} className="flex h-20 w-full items-center justify-center">
              <Spinner />
            </div>
          )}
        </div>
      </div>

      {/* Media Preview Overlay */}
      {previewIndex !== null && filteredTimeline[previewIndex] && (
        <div 
          className="fixed inset-0 z-40 bg-black/80 flex flex-col items-center justify-center pt-8"
          onClick={(e) => {
            if (e.target === e.currentTarget) closePreview();
          }}
        >
          {/* Previous button - left side */}
          {previewIndex > 0 && (
            <Button
              variant="ghost"
              size="icon"
              className="absolute left-4 top-1/2 -translate-y-1/2 text-white hover:bg-white/20 h-12 w-12 z-10"
              onClick={goToPrevious}
              aria-label="Show previous media item"
            >
              <ChevronLeft className="h-8 w-8" />
            </Button>
          )}

          {/* Counter - above media */}
          <div className="text-white text-sm bg-black/50 px-4 py-1.5 rounded-full mb-4">
            {formatNumberWithComma(previewIndex + 1)} / {formatNumberWithComma(filteredTimeline.length)}
          </div>

          {/* Media content - center */}
          <div className="max-w-[90%] max-h-[70%] flex items-center justify-center">
            {filteredTimeline[previewIndex].type === "photo" ? (
              <img
                src={getPreviewUrl(filteredTimeline[previewIndex].url)}
                alt=""
                className="max-w-full max-h-[65vh] object-contain rounded-lg"
              />
            ) : filteredTimeline[previewIndex].type === "video" ? (
              <video
                src={filteredTimeline[previewIndex].url}
                controls
                autoPlay
                className="max-w-full max-h-[65vh] rounded-lg"
              />
            ) : filteredTimeline[previewIndex].type === "text" ? (
              <div className="bg-white dark:bg-gray-800 p-6 rounded-lg max-w-2xl">
                <p className="text-lg whitespace-pre-wrap">{filteredTimeline[previewIndex].content || "No content"}</p>
                <p className="text-sm text-muted-foreground mt-4">
                  {formatDate(filteredTimeline[previewIndex].date)} {getRelativeTime(filteredTimeline[previewIndex].date)}
                </p>
              </div>
            ) : (
              <video
                src={filteredTimeline[previewIndex].url}
                autoPlay
                loop
                muted
                className="max-w-full max-h-[65vh] rounded-lg"
              />
            )}
          </div>

          {/* Tweet Stats */}
          <div className="flex items-center gap-4 mt-3 text-white/80 text-sm">
            {filteredTimeline[previewIndex].verified && (
              <span className="flex items-center gap-1 text-blue-400">
                <BadgeCheck className="h-4 w-4" />
                Verified
              </span>
            )}
            {filteredTimeline[previewIndex].width > 0 && filteredTimeline[previewIndex].height > 0 && (
              <span className="flex items-center gap-1">
                <Maximize2 className="h-4 w-4" />
                {filteredTimeline[previewIndex].width} × {filteredTimeline[previewIndex].height}
              </span>
            )}
            {filteredTimeline[previewIndex].view_count !== undefined && filteredTimeline[previewIndex].view_count > 0 && (
              <span className="flex items-center gap-1">
                <Eye className="h-4 w-4" />
                {formatNumber(filteredTimeline[previewIndex].view_count)}
              </span>
            )}
            {filteredTimeline[previewIndex].favorite_count !== undefined && filteredTimeline[previewIndex].favorite_count > 0 && (
              <span className="flex items-center gap-1">
                <Heart className="h-4 w-4" />
                {formatNumber(filteredTimeline[previewIndex].favorite_count)}
              </span>
            )}
            {filteredTimeline[previewIndex].retweet_count !== undefined && filteredTimeline[previewIndex].retweet_count > 0 && (
              <span className="flex items-center gap-1">
                <Repeat2 className="h-4 w-4" />
                {formatNumber(filteredTimeline[previewIndex].retweet_count)}
              </span>
            )}
            {filteredTimeline[previewIndex].bookmark_count !== undefined && filteredTimeline[previewIndex].bookmark_count > 0 && (
              <span className="flex items-center gap-1">
                <Bookmark className="h-4 w-4" />
                {formatNumber(filteredTimeline[previewIndex].bookmark_count)}
              </span>
            )}
            {filteredTimeline[previewIndex].source && (
              <span className="text-white/60">
                via {filteredTimeline[previewIndex].source}
              </span>
            )}
          </div>

          {/* Action buttons - bottom center */}
          <div className="flex items-center gap-3 mt-4 z-10">
            {(() => {
              const item = filteredTimeline[previewIndex];
              const itemKey = getMediaItemKey(item);
              const isItemDownloaded = downloadedItems.has(itemKey);
              const isItemFailed = failedItems.has(itemKey);
              const isItemSkipped = skippedItems.has(itemKey);
              const isItemDownloading = downloadingItem === itemKey;
              return (
                <Button
                  variant="default"
                  size="sm"
                  className="h-9"
                  onClick={() => handleSingleMediaDownload(item, itemKey)}
                  disabled={downloadingItem !== null}
                >
                  {isItemDownloading ? (
                    <Spinner className="mr-1" />
                  ) : isItemSkipped ? (
                    <FileCheck className="h-4 w-4 mr-1" />
                  ) : isItemDownloaded ? (
                    <CheckCircle className="h-4 w-4 mr-1" />
                  ) : isItemFailed ? (
                    <XCircle className="h-4 w-4 mr-1" />
                  ) : (
                    <Download className="h-4 w-4 mr-1" />
                  )}
                  {isItemDownloading ? "Downloading..." : isItemSkipped ? "Already exists" : isItemDownloaded ? "Downloaded" : isItemFailed ? "Failed" : "Download"}
                </Button>
              );
            })()}
            <Button
              variant="secondary"
              size="sm"
              className="h-9"
              onClick={() => handleOpenTweet(filteredTimeline[previewIndex].tweet_id)}
            >
              <ExternalLink className="h-4 w-4 mr-1" />
              Open Tweet
            </Button>
          </div>

          {/* Next button - right side */}
          {previewIndex < filteredTimeline.length - 1 && (
            <Button
              variant="ghost"
              size="icon"
              className="absolute right-4 top-1/2 -translate-y-1/2 text-white hover:bg-white/20 h-12 w-12 z-10"
              onClick={goToNext}
              aria-label="Show next media item"
            >
              <ChevronRight className="h-8 w-8" />
            </Button>
          )}
        </div>
      )}

      {/* Scroll to Top Button - hide when preview is open */}
      {showScrollTop && previewIndex === null && (
        <Button
          variant="default"
          size="icon"
          className="fixed bottom-6 left-1/2 -translate-x-1/2 h-9 w-9 rounded-full shadow-lg z-30"
          onClick={scrollToTop}
          aria-label="Scroll to top"
        >
          <ArrowUp className="h-4 w-4" />
        </Button>
      )}
    </div>
  );
}
