import { backend } from "../../wailsjs/go/models";

export type AccountListItem = backend.AccountListItem;

export interface GroupInfo {
  name: string;
  color: string;
}

export interface SavedAccountsWorkspaceData {
  accounts: AccountListItem[];
  groups: GroupInfo[];
}

export interface SavedAccountRef {
  id: number;
  username: string;
}

export interface SavedAccountsBootstrap {
  groups: GroupInfo[];
  publicCount: number;
  privateCount: number;
  accountRefs: SavedAccountRef[];
}

export interface SavedAccountsQueryPage {
  items: AccountListItem[];
  totalCount: number;
  hasMore: boolean;
  nextOffset: number;
}

export type DatabaseAccountViewMode = "public" | "private";

export type DatabaseSortOrder =
  | "newest"
  | "oldest"
  | "username-asc"
  | "username-desc"
  | "followers-high"
  | "followers-low"
  | "posts-high"
  | "posts-low"
  | "media-high"
  | "media-low";

export type DatabaseGridView = "gallery" | "list";
