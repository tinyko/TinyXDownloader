import {
  BadgeCheck,
  Bookmark,
  Calendar,
  CheckCircle,
  Eye,
  FileCheck,
  FileText,
  Film,
  Heart,
  Image,
  Maximize2,
  MessageSquare,
  Repeat2,
  UserPlus,
  Users,
  Video,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import type { AccountInfo, TimelineEntry } from "@/types/api";

export function getThumbnailUrl(url: string): string {
  if (url.includes("video.twimg.com/tweet_video/")) {
    const match = url.match(/tweet_video\/([^/]+)\.mp4/);
    if (match?.[1]) {
      return `https://pbs.twimg.com/tweet_video_thumb/${match[1]}?format=jpg&name=360x360`;
    }
  }

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

export function getPreviewUrl(url: string): string {
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

export function getMediaIcon(type: string): ReactNode {
  const Icon: LucideIcon =
    type === "photo"
      ? Image
      : type === "video"
        ? Video
        : type === "gif" || type === "animated_gif"
          ? Film
          : type === "text"
            ? FileText
            : Image;

  return <Icon className="h-4 w-4" />;
}

export function formatDate(dateStr: string): string {
  try {
    if (dateStr.includes("T")) {
      const [datePart, timePart] = dateStr.split("T");
      const timeClean = timePart.split("+")[0].split("Z")[0];
      return `${datePart} • ${timeClean}`;
    }
    return dateStr;
  } catch {
    return dateStr;
  }
}

export function getRelativeTime(dateStr: string): string {
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
    }
    if (diffMonths > 0) {
      const remainingDays = diffDays % 30;
      return `(${diffMonths}m ${remainingDays}d ago)`;
    }
    if (diffDays > 0) {
      const remainingHours = diffHours % 24;
      return `(${diffDays}d ${remainingHours}h ago)`;
    }
    if (diffHours > 0) {
      const remainingMinutes = diffMinutes % 60;
      return `(${diffHours}h ${remainingMinutes}m ago)`;
    }
    if (diffMinutes > 0) {
      return `(${diffMinutes}m ago)`;
    }
    return "(just now)";
  } catch {
    return "";
  }
}

export function formatCompactNumber(num: number): string {
  if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
  if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
  return String(num);
}

export function formatNumberWithComma(num: number): string {
  return num.toLocaleString();
}

export function formatJoinDate(dateStr: string): string {
  try {
    const date = new Date(dateStr);
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    return `${months[date.getMonth()]} ${date.getFullYear()}`;
  } catch {
    return dateStr;
  }
}

export function getAccountFolderName(accountInfo: AccountInfo): string {
  if (accountInfo.nick === "My Bookmarks" || accountInfo.name === "bookmarks") {
    return "My Bookmarks";
  }
  if (accountInfo.nick === "My Likes" || accountInfo.name === "likes") {
    return "My Likes";
  }
  return accountInfo.name;
}

export function buildAccountOutputDir(basePath: string, accountInfo: AccountInfo): string {
  if (accountInfo.nick === "My Bookmarks") {
    const separator = basePath.includes("/") ? "/" : "\\";
    return `${basePath}${separator}My Bookmarks`;
  }
  if (accountInfo.nick === "My Likes") {
    const separator = basePath.includes("/") ? "/" : "\\";
    return `${basePath}${separator}My Likes`;
  }
  return basePath;
}

export function buildAccountFolderPath(downloadPath: string, accountFolderName: string): string {
  if (!downloadPath) {
    return accountFolderName;
  }
  const separator = downloadPath.includes("\\") ? "\\" : "/";
  return `${downloadPath}${separator}${accountFolderName}`;
}

export function getMediaWorkspaceStats(item: TimelineEntry) {
  return [
    item.verified
      ? {
          key: "verified",
          icon: BadgeCheck,
          text: "Verified",
          className: "text-blue-400",
        }
      : null,
    item.width > 0 && item.height > 0
      ? {
          key: "resolution",
          icon: Maximize2,
          text: `${item.width} × ${item.height}`,
        }
      : null,
    item.view_count && item.view_count > 0
      ? { key: "views", icon: Eye, text: formatCompactNumber(item.view_count) }
      : null,
    item.favorite_count && item.favorite_count > 0
      ? { key: "favorites", icon: Heart, text: formatCompactNumber(item.favorite_count) }
      : null,
    item.retweet_count && item.retweet_count > 0
      ? { key: "retweets", icon: Repeat2, text: formatCompactNumber(item.retweet_count) }
      : null,
    item.bookmark_count && item.bookmark_count > 0
      ? { key: "bookmarks", icon: Bookmark, text: formatCompactNumber(item.bookmark_count) }
      : null,
    item.source
      ? { key: "source", icon: null, text: `via ${item.source}` }
      : null,
  ].filter(Boolean);
}

export function getAccountSummaryStats(accountInfo: AccountInfo) {
  return [
    {
      key: "followers",
      icon: Users,
      text: `${formatCompactNumber(accountInfo.followers_count)} followers`,
    },
    {
      key: "following",
      icon: UserPlus,
      text: `${formatCompactNumber(accountInfo.friends_count)} following`,
    },
    {
      key: "posts",
      icon: MessageSquare,
      text: `${formatCompactNumber(accountInfo.statuses_count)} posts`,
    },
    accountInfo.date
      ? {
          key: "joined",
          icon: Calendar,
          text: `Joined ${formatJoinDate(accountInfo.date)}`,
        }
      : null,
  ].filter(Boolean);
}

export function getDownloadStatusIcon(status: "downloaded" | "failed" | "skipped" | "idle") {
  if (status === "downloaded") return CheckCircle;
  if (status === "failed") return XCircle;
  if (status === "skipped") return FileCheck;
  return null;
}
