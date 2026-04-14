import fs from "node:fs";

import { SEEDED_JSON_PATH } from "./constants";

export interface SavedAccountsFixtureAccount {
  id: number;
  username: string;
  name: string;
  profile_image: string;
  total_media: number;
  last_fetched: string;
  group_name: string;
  group_color: string;
  media_type: string;
  timeline_type: string;
  retweets: boolean;
  query_key: string;
  cursor: string;
  completed: boolean;
  followers_count: number;
  statuses_count: number;
}

export interface SavedAccountsFixture {
  public_count: number;
  private_count: number;
  groups: Array<{
    name: string;
    color: string;
  }>;
  accounts: SavedAccountsFixtureAccount[];
}

export function loadSavedAccountsFixture(): SavedAccountsFixture {
  return JSON.parse(
    fs.readFileSync(SEEDED_JSON_PATH, "utf-8")
  ) as SavedAccountsFixture;
}
