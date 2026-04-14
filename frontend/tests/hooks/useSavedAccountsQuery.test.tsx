import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useSavedAccountsQuery } from "@/hooks/database/useSavedAccountsQuery";
import {
  loadSavedAccountMatchingIds,
  querySavedAccountsPage,
} from "@/lib/database-client";
import type {
  AccountListItem,
  DatabaseGridView,
  DatabaseSortOrder,
  SavedAccountsQueryPage,
} from "@/types/database";

vi.mock("@/lib/database-client", () => ({
  querySavedAccountsPage: vi.fn(),
  loadSavedAccountMatchingIds: vi.fn(),
}));

interface QueryArgs {
  accountViewMode: "public" | "private";
  searchQuery: string;
  filterGroup: string;
  filterMediaType: string;
  sortOrder: DatabaseSortOrder;
  gridView: DatabaseGridView;
}

function createAccount(id: number, username = `account-${id}`): AccountListItem {
  return {
    id,
    username,
    name: `Account ${id}`,
    profile_image: "",
    total_media: id * 10,
    last_fetched: "",
    group_name: "",
    group_color: "",
    media_type: "all",
    timeline_type: "timeline",
    retweets: false,
    query_key: "",
    cursor: "",
    completed: true,
    followers_count: id * 100,
    statuses_count: id * 50,
  };
}

function createPage(overrides: Partial<SavedAccountsQueryPage> = {}): SavedAccountsQueryPage {
  return {
    items: [],
    totalCount: 0,
    hasMore: false,
    nextOffset: 0,
    ...overrides,
  };
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const baseArgs: QueryArgs = {
  accountViewMode: "public",
  searchQuery: "",
  filterGroup: "all",
  filterMediaType: "all",
  sortOrder: "newest",
  gridView: "list",
};

describe("useSavedAccountsQuery", () => {
  beforeEach(() => {
    vi.mocked(querySavedAccountsPage).mockReset();
    vi.mocked(loadSavedAccountMatchingIds).mockReset();
  });

  it("loads the first page and matching ids using the gallery page size", async () => {
    vi.mocked(querySavedAccountsPage).mockResolvedValueOnce(
      createPage({
        items: [createAccount(1)],
        totalCount: 1,
      })
    );
    vi.mocked(loadSavedAccountMatchingIds).mockResolvedValueOnce([1]);

    const { result } = renderHook(() =>
      useSavedAccountsQuery({
        ...baseArgs,
        gridView: "gallery",
      })
    );

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(querySavedAccountsPage).toHaveBeenCalledWith({
      accountViewMode: "public",
      searchQuery: "",
      filterGroup: "all",
      filterMediaType: "all",
      sortOrder: "newest",
      offset: 0,
      limit: 48,
    });
    expect(loadSavedAccountMatchingIds).toHaveBeenCalledWith({
      accountViewMode: "public",
      searchQuery: "",
      filterGroup: "all",
      filterMediaType: "all",
    });
    expect(result.current.accounts.map((account) => account.id)).toEqual([1]);
    expect(result.current.matchingIds).toEqual([1]);
  });

  it("loads more results only when available and deduplicates appended accounts", async () => {
    vi.mocked(querySavedAccountsPage)
      .mockResolvedValueOnce(
        createPage({
          items: [createAccount(1)],
          totalCount: 3,
          hasMore: true,
          nextOffset: 100,
        })
      )
      .mockResolvedValueOnce(
        createPage({
          items: [createAccount(1), createAccount(2)],
          totalCount: 3,
          hasMore: false,
          nextOffset: 200,
        })
      );
    vi.mocked(loadSavedAccountMatchingIds).mockResolvedValueOnce([1, 2, 3]);

    const { result } = renderHook(() => useSavedAccountsQuery(baseArgs));

    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.loadMore();
    });

    expect(querySavedAccountsPage).toHaveBeenNthCalledWith(2, {
      accountViewMode: "public",
      searchQuery: "",
      filterGroup: "all",
      filterMediaType: "all",
      sortOrder: "newest",
      offset: 100,
      limit: 100,
    });
    expect(result.current.accounts.map((account) => account.id)).toEqual([1, 2]);
    expect(result.current.hasMore).toBe(false);
  });

  it("refreshes the first page and matching ids", async () => {
    vi.mocked(querySavedAccountsPage)
      .mockResolvedValueOnce(
        createPage({
          items: [createAccount(1)],
          totalCount: 2,
          hasMore: true,
          nextOffset: 100,
        })
      )
      .mockResolvedValueOnce(
        createPage({
          items: [createAccount(1), createAccount(2)],
          totalCount: 2,
          hasMore: false,
          nextOffset: 200,
        })
      )
      .mockResolvedValueOnce(
        createPage({
          items: [createAccount(3)],
          totalCount: 1,
          hasMore: false,
          nextOffset: 0,
        })
      );
    vi.mocked(loadSavedAccountMatchingIds)
      .mockResolvedValueOnce([1, 2])
      .mockResolvedValueOnce([3]);

    const { result } = renderHook(() => useSavedAccountsQuery(baseArgs));

    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.loadMore();
    });

    await act(async () => {
      await result.current.refresh();
    });

    expect(querySavedAccountsPage).toHaveBeenLastCalledWith({
      accountViewMode: "public",
      searchQuery: "",
      filterGroup: "all",
      filterMediaType: "all",
      sortOrder: "newest",
      offset: 0,
      limit: 100,
    });
    expect(loadSavedAccountMatchingIds).toHaveBeenLastCalledWith({
      accountViewMode: "public",
      searchQuery: "",
      filterGroup: "all",
      filterMediaType: "all",
    });
    expect(result.current.accounts.map((account) => account.id)).toEqual([3]);
    expect(result.current.matchingIds).toEqual([3]);
    expect(result.current.hasMore).toBe(false);
  });

  it("ignores late results from an outdated query", async () => {
    const firstPage = createDeferred<SavedAccountsQueryPage | null>();
    const firstIds = createDeferred<number[]>();
    const secondPage = createDeferred<SavedAccountsQueryPage | null>();
    const secondIds = createDeferred<number[]>();

    vi.mocked(querySavedAccountsPage)
      .mockImplementationOnce(() => firstPage.promise)
      .mockImplementationOnce(() => secondPage.promise);
    vi.mocked(loadSavedAccountMatchingIds)
      .mockImplementationOnce(() => firstIds.promise)
      .mockImplementationOnce(() => secondIds.promise);

    const { result, rerender } = renderHook(
      (args: QueryArgs) => useSavedAccountsQuery(args),
      {
        initialProps: {
          ...baseArgs,
          searchQuery: "alpha",
        },
      }
    );

    rerender({
      ...baseArgs,
      searchQuery: "beta",
    });

    await act(async () => {
      secondPage.resolve(
        createPage({
          items: [createAccount(2, "beta")],
          totalCount: 1,
        })
      );
      secondIds.resolve([2]);
      await Promise.resolve();
    });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.accounts.map((account) => account.username)).toEqual(["beta"]);

    await act(async () => {
      firstPage.resolve(
        createPage({
          items: [createAccount(1, "alpha")],
          totalCount: 1,
        })
      );
      firstIds.resolve([1]);
      await Promise.resolve();
    });

    expect(result.current.accounts.map((account) => account.username)).toEqual(["beta"]);
    expect(result.current.matchingIds).toEqual([2]);
  });

  it("stops loading when the initial request fails", async () => {
    vi.mocked(querySavedAccountsPage).mockRejectedValueOnce(new Error("boom"));
    vi.mocked(loadSavedAccountMatchingIds).mockResolvedValueOnce([]);

    const { result } = renderHook(() => useSavedAccountsQuery(baseArgs));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.accounts).toEqual([]);
    expect(result.current.matchingIds).toEqual([]);
    expect(result.current.hasMore).toBe(false);
  });
});
