import { backend } from "../../wailsjs/go/models";

export type AccountListItem = backend.AccountListItem;

export interface GroupInfo {
  name: string;
  color: string;
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
