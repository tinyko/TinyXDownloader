import type { AccountListItem } from "@/types/database";

export function formatNumberWithComma(num: number): string {
  return num.toLocaleString();
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

export function isPrivateAccount(username: string) {
  return username === "bookmarks" || username === "likes";
}

export function resolveAccountFolderName(account: AccountListItem) {
  if (account.username === "bookmarks") {
    return "My Bookmarks";
  }
  if (account.username === "likes") {
    return "My Likes";
  }
  return account.username;
}

export function buildScopeRequest(account: AccountListItem) {
  return {
    username: account.username,
    media_type: account.media_type || "all",
    timeline_type: account.timeline_type || "timeline",
    retweets: account.retweets ?? false,
    query_key: account.query_key || "",
  };
}
