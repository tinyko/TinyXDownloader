import { useState } from "react";

import type { AccountListItem } from "@/types/database";
import type { UseDatabaseActionsOptions } from "@/hooks/database/databaseActionTypes";
import { DeleteAccountFromDB, UpdateAccountGroup } from "../../../wailsjs/go/main/App";
import { toastWithSound as toast } from "@/lib/toast-with-sound";

type UseDatabaseMutationActionsArgs = Pick<
  UseDatabaseActionsOptions,
  | "accountRefs"
  | "allMatchingIds"
  | "selectedIds"
  | "setSelectedIds"
  | "loadAccounts"
  | "onLoadAccount"
  | "onUpdateSelected"
>;

export function useDatabaseMutationActions({
  accountRefs,
  allMatchingIds,
  selectedIds,
  setSelectedIds,
  loadAccounts,
  onLoadAccount,
  onUpdateSelected,
}: UseDatabaseMutationActionsArgs) {
  const [editingAccount, setEditingAccount] = useState<AccountListItem | null>(null);
  const [editGroupName, setEditGroupName] = useState("");
  const [editGroupColor, setEditGroupColor] = useState("");
  const [clearAllDialogOpen, setClearAllDialogOpen] = useState(false);

  const handleEditGroup = (account: AccountListItem) => {
    setEditingAccount(account);
    setEditGroupName(account.group_name || "");
    setEditGroupColor(account.group_color || "#3b82f6");
  };

  const handleSaveGroup = async () => {
    if (!editingAccount) return;
    try {
      await UpdateAccountGroup(editingAccount.id, editGroupName, editGroupColor);
      toast.success(`Updated group for @${editingAccount.username}`);
      setEditingAccount(null);
      await loadAccounts();
    } catch {
      toast.error("Failed to update group");
    }
  };

  const handleDelete = async (id: number, username: string) => {
    try {
      await DeleteAccountFromDB(id);
      toast.success(`Deleted @${username}`);
      await loadAccounts();
    } catch {
      toast.error("Failed to delete account");
    }
  };

  const handleView = async (account: AccountListItem) => {
    try {
      await onLoadAccount(account);
    } catch {
      toast.error("Failed to load account data");
    }
  };

  const handleUpdateSelected = async () => {
    const idsToUpdate =
      selectedIds.size > 0
        ? Array.from(selectedIds)
        : allMatchingIds;
    if (idsToUpdate.length === 0) {
      toast.error("No accounts selected");
      return;
    }

    const usernamesById = new Map(accountRefs.map((account) => [account.id, account.username]));
    const usernames = idsToUpdate
      .map((id) => usernamesById.get(id))
      .filter((username): username is string => !!username);

    if (usernames.length === 0) {
      toast.error("No valid usernames found");
      return;
    }

    if (onUpdateSelected) {
      try {
        await onUpdateSelected(usernames);
      } catch {
        toast.error("Failed to start account updates");
      }
    }
  };

  const handleDeleteSelected = async () => {
    try {
      const idsToDelete = Array.from(selectedIds);
      for (const id of idsToDelete) {
        await DeleteAccountFromDB(id);
      }
      toast.success(
        `Deleted ${idsToDelete.length.toLocaleString()} account${
          idsToDelete.length !== 1 ? "s" : ""
        }`
      );
      setClearAllDialogOpen(false);
      setSelectedIds(new Set());
      await loadAccounts();
    } catch {
      toast.error("Failed to delete accounts");
    }
  };

  return {
    editingAccount,
    editGroupName,
    editGroupColor,
    clearAllDialogOpen,
    setEditingAccount,
    setEditGroupName,
    setEditGroupColor,
    setClearAllDialogOpen,
    handleEditGroup,
    handleSaveGroup,
    handleDelete,
    handleView,
    handleUpdateSelected,
    handleDeleteSelected,
  };
}
