import { startTransition, useCallback, useEffect, useState } from "react";

import type {
  AccountListItem,
  GroupInfo,
} from "@/types/database";
import { resolveAccountFolderName } from "@/lib/database/helpers";
import { getSettings } from "@/lib/settings";
import { toastWithSound as toast } from "@/lib/toast-with-sound";
import {
  GetAllAccountsFromDB,
  GetAllGroups,
  GetDownloadDirectorySnapshot,
} from "../../../wailsjs/go/main/App";

export function useDatabaseAccountsData() {
  const [accounts, setAccounts] = useState<AccountListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [groups, setGroups] = useState<GroupInfo[]>([]);
  const [folderExistence, setFolderExistence] = useState<Map<number, boolean>>(
    new Map()
  );

  const checkFolderExistence = useCallback(async (accountsList: AccountListItem[]) => {
    const settings = getSettings();
    const basePath = settings.downloadPath;
    if (!basePath || accountsList.length === 0) {
      setFolderExistence(new Map());
      return;
    }

    const snapshot = await GetDownloadDirectorySnapshot(basePath);
    const existingFolders = new Set(snapshot || []);

    const folderMap = new Map<number, boolean>();
    for (const account of accountsList) {
      folderMap.set(
        account.id,
        existingFolders.has(resolveAccountFolderName(account))
      );
    }

    setFolderExistence(folderMap);
  }, []);

  const loadSecondaryData = useCallback(
    async (accountsList: AccountListItem[]) => {
      try {
        const groupsData = await GetAllGroups();
        if (groupsData) {
          setGroups(
            groupsData.map((group) => ({
              name: group.name || "",
              color: group.color || "",
            }))
          );
        }
      } catch (error) {
        console.error("Failed to load groups:", error);
      }

      try {
        window.setTimeout(() => {
          void checkFolderExistence(accountsList);
        }, 0);
      } catch (error) {
        console.error("Failed to check folder existence:", error);
      }
    },
    [checkFolderExistence]
  );

  const loadAccounts = useCallback(async () => {
    setLoading(true);
    setFolderExistence(new Map());
    try {
      const data = await GetAllAccountsFromDB();
      const accountList = data || [];
      startTransition(() => {
        setAccounts(accountList);
        setLoading(false);
      });

      window.setTimeout(() => {
        void loadSecondaryData(accountList);
      }, 0);
    } catch (error) {
      console.error("Failed to load accounts:", error);
      toast.error("Failed to load accounts");
      setLoading(false);
    }
  }, [loadSecondaryData]);

  const refreshFolderExistence = useCallback(async () => {
    await checkFolderExistence(accounts);
  }, [accounts, checkFolderExistence]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadAccounts();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadAccounts]);

  return {
    accounts,
    loading,
    groups,
    folderExistence,
    loadAccounts,
    refreshFolderExistence,
  };
}
