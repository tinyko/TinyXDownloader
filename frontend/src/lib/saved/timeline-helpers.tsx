import { FileText, Film, Image, Video } from "lucide-react";

export function formatNumberWithComma(num: number): string {
  return num.toLocaleString();
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

    if (diffDays > 0) {
      return `(${diffDays}d ${diffHours % 24}h ago)`;
    }
    if (diffHours > 0) {
      return `(${diffHours}h ${diffMinutes % 60}m ago)`;
    }
    if (diffMinutes > 0) {
      return `(${diffMinutes}m ago)`;
    }
    return "(just now)";
  } catch {
    return "";
  }
}

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
        return `${parts[0]}&name=360x360`;
      }
      return `${url}&name=360x360`;
    }
    if (url.includes("?")) {
      return `${url}&name=360x360`;
    }
    return `${url}?format=jpg&name=360x360`;
  }
  return url;
}

export function getPreviewUrl(url: string): string {
  if (url.includes("pbs.twimg.com/media/")) {
    if (url.includes("?format=")) {
      if (url.includes("&name=")) {
        const parts = url.split("&name=");
        return `${parts[0]}&name=large`;
      }
      return `${url}&name=large`;
    }
    if (url.includes("?")) {
      return `${url}&name=large`;
    }
    return `${url}?format=jpg&name=large`;
  }
  return url;
}

export function getMediaIcon(type: string) {
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
