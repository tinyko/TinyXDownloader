import { startTransition, useCallback, useEffect, useRef, useState } from "react";

import type {
  AccountListItem,
  GroupInfo,
  SavedAccountRef,
} from "@/types/database";
import { resolveAccountFolderName } from "@/lib/database/helpers";
import {
  getSettings,
  SETTINGS_CHANGED_EVENT,
  type Settings,
} from "@/lib/settings";
import { toastWithSound as toast } from "@/lib/toast-with-sound";
import { GetDownloadDirectorySnapshot } from "../../../wailsjs/go/main/App";
import { loadSavedAccountsBootstrap } from "@/lib/database-client";

export function useDatabaseAccountsData() {
  const [loading, setLoading] = useState(true);
  const [groups, setGroups] = useState<GroupInfo[]>([]);
  const [accountRefs, setAccountRefs] = useState<SavedAccountRef[]>([]);
  const [publicCount, setPublicCount] = useState(0);
  const [privateCount, setPrivateCount] = useState(0);
  const [folderExistence, setFolderExistence] = useState<Map<number, boolean>>(
    new Map()
  );
  const initialLoadRef = useRef(true);
  const folderSnapshotCacheRef = useRef<{
    downloadPath: string;
    folders: Set<string>;
  } | null>(null);
  const lastDownloadPathRef = useRef("");

  const buildFolderExistenceMap = useCallback(
    (accountsList: AccountListItem[], existingFolders: Set<string>) => {
      const folderMap = new Map<number, boolean>();
      for (const account of accountsList) {
        folderMap.set(
          account.id,
          existingFolders.has(resolveAccountFolderName(account))
        );
      }
      return folderMap;
    },
    []
  );

  const getFolderSnapshot = useCallback(
    async (downloadPath: string, forceRefresh: boolean) => {
      if (!downloadPath) {
        folderSnapshotCacheRef.current = {
          downloadPath: "",
          folders: new Set(),
        };
        lastDownloadPathRef.current = "";
        return new Set<string>();
      }

      const cached = folderSnapshotCacheRef.current;
      if (!forceRefresh && cached && cached.downloadPath === downloadPath) {
        return cached.folders;
      }

      const snapshot = await GetDownloadDirectorySnapshot(downloadPath);
      const folders = new Set(snapshot || []);
      folderSnapshotCacheRef.current = {
        downloadPath,
        folders,
      };
      lastDownloadPathRef.current = downloadPath;
      return folders;
    },
    []
  );

  const checkFolderExistence = useCallback(async (
    accountsList: AccountListItem[],
    forceRefresh = false,
    explicitSettings?: Settings
  ) => {
    const settings = explicitSettings || getSettings();
    const basePath = settings.downloadPath;
    if (!basePath || accountsList.length === 0) {
      setFolderExistence(new Map());
      lastDownloadPathRef.current = basePath;
      return;
    }

    const existingFolders = await getFolderSnapshot(basePath, forceRefresh);
    setFolderExistence(buildFolderExistenceMap(accountsList, existingFolders));
  }, [buildFolderExistenceMap, getFolderSnapshot]);

  const loadAccounts = useCallback(async () => {
    if (initialLoadRef.current) {
      setLoading(true);
    }

    try {
      const bootstrap = await loadSavedAccountsBootstrap();
      const groupList = bootstrap?.groups || [];
      const nextAccountRefs = bootstrap?.accountRefs || [];
      const nextPublicCount = bootstrap?.publicCount || 0;
      const nextPrivateCount = bootstrap?.privateCount || 0;

      startTransition(() => {
        setGroups(groupList);
        setAccountRefs(nextAccountRefs);
        setPublicCount(nextPublicCount);
        setPrivateCount(nextPrivateCount);
        setLoading(false);
        initialLoadRef.current = false;
      });
    } catch (error) {
      console.error("Failed to load accounts:", error);
      toast.error("Failed to load accounts");
      setLoading(false);
    }
  }, []);

  const refreshFolderExistence = useCallback(async () => {
    folderSnapshotCacheRef.current = null;
    setFolderExistence(new Map());
  }, []);

  const syncFolderExistence = useCallback(async (
    accountsList: AccountListItem[],
    forceRefresh = false,
    explicitSettings?: Settings
  ) => {
    await checkFolderExistence(accountsList, forceRefresh, explicitSettings);
  }, [checkFolderExistence]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadAccounts();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadAccounts]);

  useEffect(() => {
    const handleSettingsChanged = (event: Event) => {
      const nextSettings = (event as CustomEvent<Settings>).detail || getSettings();
      const nextDownloadPath = nextSettings.downloadPath || "";
      if (nextDownloadPath === lastDownloadPathRef.current) {
        return;
      }

      setFolderExistence(new Map());
      lastDownloadPathRef.current = nextDownloadPath;
    };

    window.addEventListener(SETTINGS_CHANGED_EVENT, handleSettingsChanged as EventListener);
    return () => {
      window.removeEventListener(
        SETTINGS_CHANGED_EVENT,
        handleSettingsChanged as EventListener
      );
    };
  }, []);

  return {
    loading,
    groups,
    accountRefs,
    publicCount,
    privateCount,
    folderExistence,
    loadAccounts,
    refreshFolderExistence,
    syncFolderExistence,
  };
}
