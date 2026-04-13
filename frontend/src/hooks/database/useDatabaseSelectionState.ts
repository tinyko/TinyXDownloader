import { useMemo, useState } from "react";

import type { AccountListItem } from "@/types/database";

export function useDatabaseSelectionState(filteredAccounts: AccountListItem[]) {
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

  const selectedAccounts = useMemo(
    () => filteredAccounts.filter((account) => selectedIds.has(account.id)),
    [filteredAccounts, selectedIds]
  );

  const focusedAccount =
    selectedAccounts.length === 1 ? selectedAccounts[0] : null;

  const toggleSelect = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === filteredAccounts.length && filteredAccounts.length > 0) {
      setSelectedIds(new Set());
      return;
    }
    setSelectedIds(new Set(filteredAccounts.map((account) => account.id)));
  };

  return {
    selectedIds,
    setSelectedIds,
    selectedAccounts,
    focusedAccount,
    toggleSelect,
    toggleSelectAll,
  };
}
