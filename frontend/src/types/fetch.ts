export type FetchMode = "public" | "private";
export type PrivateType = "bookmarks" | "likes";
export type FetchType = "single" | "multiple";

export interface HistoryItem {
  id: string;
  username: string;
  name: string;
  image: string;
  mediaCount: number;
  timestamp: number;
}

export interface MultipleAccount {
  id: string;
  username: string;
  mode?: FetchMode;
  privateType?: PrivateType;
  mediaType?: string;
  retweets?: boolean;
  status: "pending" | "fetching" | "completed" | "incomplete" | "failed";
  accountInfo?: {
    name: string;
    nick: string;
    profile_image: string;
  };
  mediaCount: number;
  previousMediaCount: number;
  elapsedTime: number;
  remainingTime: number | null;
  error?: string;
  showDiff?: boolean;
  cursor?: string;
}
