import { useMemo, useState } from "react";

import type { AccountListItem } from "@/types/database";

export function useDatabaseSelectionState(
  visibleAccounts: AccountListItem[],
  allMatchingIds: number[]
) {
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

  const selectedAccounts = useMemo(
    () => visibleAccounts.filter((account) => selectedIds.has(account.id)),
    [selectedIds, visibleAccounts]
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
    const allMatchingSelected =
      allMatchingIds.length > 0 &&
      allMatchingIds.every((id) => selectedIds.has(id));

    if (allMatchingSelected) {
      setSelectedIds(new Set());
      return;
    }
    setSelectedIds(new Set(allMatchingIds));
  };

  return {
    selectedIds,
    setSelectedIds,
    selectedAccounts,
    focusedAccount,
    allMatchingSelected:
      allMatchingIds.length > 0 &&
      allMatchingIds.every((id) => selectedIds.has(id)),
    toggleSelect,
    toggleSelectAll,
  };
}
