import { useEffect, useRef, useState } from "react";
import { ArrowUp } from "lucide-react";

import { DatabaseAccountsGallery } from "@/components/database/DatabaseAccountsGallery";
import { DatabaseAccountsList } from "@/components/database/DatabaseAccountsList";
import { DatabaseBulkProgress } from "@/components/database/DatabaseBulkProgress";
import { DatabaseEditGroupDialog } from "@/components/database/DatabaseEditGroupDialog";
import { DatabaseFiltersBar } from "@/components/database/DatabaseFiltersBar";
import { DatabaseHeaderBar } from "@/components/database/DatabaseHeaderBar";
import { DatabaseRecentFetches } from "@/components/database/DatabaseRecentFetches";
import { DatabaseSelectionSummary } from "@/components/database/DatabaseSelectionSummary";
import { Button } from "@/components/ui/button";
import { loadSavedAccountsByIds } from "@/lib/database-client";
import { useDatabaseAccountsData } from "@/hooks/database/useDatabaseAccountsData";
import { useDatabaseActions } from "@/hooks/database/useDatabaseActions";
import { useDatabaseSelectionState } from "@/hooks/database/useDatabaseSelectionState";
import { useSavedAccountsQuery } from "@/hooks/database/useSavedAccountsQuery";
import type {
  AccountListItem,
  DatabaseGridView,
  DatabaseSortOrder,
} from "@/types/database";
import type {
  GlobalDownloadSessionMeta,
  GlobalDownloadState,
} from "@/types/download";
import type { HistoryItem } from "@/types/fetch";

interface DatabaseWorkspaceProps {
  onLoadAccount: (account: AccountListItem) => void | Promise<void>;
  onUpdateSelected?: (usernames: string[]) => void | Promise<void>;
  downloadState?: GlobalDownloadState | null;
  downloadMeta?: GlobalDownloadSessionMeta | null;
  onStopDownload?: () => void | Promise<void>;
  onDownloadSessionStart?: (meta: GlobalDownloadSessionMeta) => void;
  recentFetches?: HistoryItem[];
  onSelectRecentFetch?: (item: HistoryItem) => void;
  onRemoveRecentFetch?: (id: string) => void;
  onClearRecentFetches?: () => void;
}

export function DatabaseWorkspace({
  onLoadAccount,
  onUpdateSelected,
  downloadState = null,
  downloadMeta = null,
  onStopDownload,
  onDownloadSessionStart,
  recentFetches = [],
  onSelectRecentFetch,
  onRemoveRecentFetch,
  onClearRecentFetches,
}: DatabaseWorkspaceProps) {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const loadMoreRef = useRef<HTMLDivElement>(null);

  const [showScrollTop, setShowScrollTop] = useState(false);
  const [filterGroup, setFilterGroup] = useState<string>("all");
  const [filterMediaType, setFilterMediaType] = useState<string>("all");
  const [accountViewMode, setAccountViewMode] = useState<"public" | "private">(
    "public"
  );
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [sortOrder, setSortOrder] = useState<DatabaseSortOrder>("newest");
  const [gridView, setGridView] = useState<DatabaseGridView>("list");

  const downloadingAccountId = downloadState?.in_progress
    ? downloadMeta?.accountId ?? null
    : null;
  const downloadProgress = downloadState?.in_progress ? downloadState : null;

  const {
    loading,
    groups,
    accountRefs,
    publicCount,
    privateCount,
    folderExistence,
    loadAccounts,
    syncFolderExistence,
  } = useDatabaseAccountsData();

  const {
    accounts,
    matchingIds,
    totalCount,
    hasMore,
    loadingMore,
    loadMore,
    refresh,
  } = useSavedAccountsQuery({
    accountViewMode,
    searchQuery,
    filterGroup,
    filterMediaType,
    sortOrder,
    gridView,
  });

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) {
      return;
    }

    const handleScroll = () => {
      setShowScrollTop(container.scrollTop > 300);
    };

    container.addEventListener("scroll", handleScroll, { passive: true });
    handleScroll();

    return () => container.removeEventListener("scroll", handleScroll);
  }, []);

  useEffect(() => {
    void syncFolderExistence(accounts);
  }, [accounts, syncFolderExistence]);

  useEffect(() => {
    if (gridView !== "gallery" || !hasMore) {
      return;
    }

    const target = loadMoreRef.current;
    if (!target) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          void loadMore();
        }
      },
      { threshold: 0.1, rootMargin: "100px" }
    );

    observer.observe(target);
    return () => observer.disconnect();
  }, [gridView, hasMore, loadMore, loadingMore]);

  const {
    selectedIds,
    setSelectedIds,
    selectedAccounts,
    focusedAccount,
    allMatchingSelected,
    toggleSelect,
    toggleSelectAll,
  } = useDatabaseSelectionState(accounts, matchingIds);

  const refreshFolderExistence = async () => {
    await syncFolderExistence(accounts, true);
  };

  const refreshWorkspace = async () => {
    await Promise.all([loadAccounts(), refresh()]);
  };

  const {
    editingAccount,
    editGroupName,
    editGroupColor,
    clearAllDialogOpen,
    isBulkDownloading,
    bulkDownloadCurrent,
    bulkDownloadTotal,
    isDownloading,
    hasPrivateAccountSelected,
    handleEditGroup,
    handleSaveGroup,
    handleDelete,
    handleView,
    handleOpenFolder,
    handleDownload,
    handleBulkDownload,
    handleStopBulkDownload,
    handleUpdateSelected,
    handleDeleteSelected,
    handleExportJSON,
    handleExportSingleAccount,
    handleExportTXT,
    handleImport,
    setEditingAccount,
    setEditGroupName,
    setEditGroupColor,
    setClearAllDialogOpen,
  } = useDatabaseActions({
    accounts,
    accountRefs,
    allMatchingIds: matchingIds,
    selectedIds,
    setSelectedIds,
    resolveAccountsByIds: loadSavedAccountsByIds,
    loadAccounts: refreshWorkspace,
    refreshFolderExistence,
    onLoadAccount,
    onUpdateSelected,
    onStopDownload,
    onDownloadSessionStart,
    downloadState,
  });

  const scrollToTop = () => {
    scrollContainerRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div ref={scrollContainerRef} className="min-h-0 flex-1 overflow-y-auto pr-1">
        <div className="space-y-4 pb-4">
          <DatabaseHeaderBar
            accountViewMode={accountViewMode}
            onAccountViewModeChange={setAccountViewMode}
            publicCount={publicCount}
            privateCount={privateCount}
            selectedCount={selectedIds.size}
            hasPrivateAccountSelected={hasPrivateAccountSelected}
            isBulkDownloading={isBulkDownloading}
            isDownloading={isDownloading}
            clearAllDialogOpen={clearAllDialogOpen}
            onClearAllDialogOpenChange={setClearAllDialogOpen}
            onImport={handleImport}
            onExportJSON={handleExportJSON}
            onExportTXT={handleExportTXT}
            onUpdateSelected={handleUpdateSelected}
            onBulkDownload={handleBulkDownload}
            onStopBulkDownload={handleStopBulkDownload}
            onDeleteSelected={handleDeleteSelected}
          />

          <DatabaseRecentFetches
            recentFetches={recentFetches}
            onSelectRecentFetch={onSelectRecentFetch}
            onRemoveRecentFetch={onRemoveRecentFetch}
            onClearRecentFetches={onClearRecentFetches}
          />

          {loading ? (
            <div className="py-12 text-center text-muted-foreground">Loading...</div>
          ) : totalCount === 0 ? (
            <div className="py-12 text-center text-muted-foreground">
              No saved accounts yet. Fetch a user's media to save it here.
            </div>
          ) : (
            <div className="space-y-2">
              <DatabaseFiltersBar
                accountViewMode={accountViewMode}
                selectedCount={selectedIds.size}
                allVisibleSelected={allMatchingSelected}
                onToggleSelectAll={toggleSelectAll}
                searchQuery={searchQuery}
                onSearchQueryChange={setSearchQuery}
                filterGroup={filterGroup}
                onFilterGroupChange={setFilterGroup}
                filterMediaType={filterMediaType}
                onFilterMediaTypeChange={setFilterMediaType}
                sortOrder={sortOrder}
                onSortOrderChange={setSortOrder}
                gridView={gridView}
                onGridViewChange={setGridView}
                groups={groups}
              />

              <DatabaseSelectionSummary
                selectedAccounts={selectedAccounts}
                selectedCount={selectedIds.size}
                focusedAccount={focusedAccount}
                folderExistence={folderExistence}
                isDownloading={isDownloading}
                onView={handleView}
                onDownload={handleDownload}
                onOpenFolder={handleOpenFolder}
                onExportJSON={handleExportJSON}
                onBulkDownload={handleBulkDownload}
              />

              {isBulkDownloading ? (
                <DatabaseBulkProgress
                  current={bulkDownloadCurrent}
                  total={bulkDownloadTotal}
                />
              ) : null}

              {gridView === "gallery" ? (
                <>
                  <DatabaseAccountsGallery
                    accounts={accounts}
                    selectedIds={selectedIds}
                    folderExistence={folderExistence}
                    downloadingAccountId={downloadingAccountId}
                    downloadProgress={downloadProgress}
                    isDownloading={isDownloading}
                    onToggleSelect={toggleSelect}
                    onView={handleView}
                    onDownload={handleDownload}
                    onOpenFolder={handleOpenFolder}
                    onEditGroup={handleEditGroup}
                    onExportAccount={handleExportSingleAccount}
                    onDelete={handleDelete}
                    onStopDownload={onStopDownload}
                  />
                  <div
                    ref={loadMoreRef}
                    className={`h-4 ${!hasMore ? "hidden" : ""}`}
                  />
                </>
              ) : (
                <>
                  <DatabaseAccountsList
                    accounts={accounts}
                    selectedIds={selectedIds}
                    folderExistence={folderExistence}
                    downloadingAccountId={downloadingAccountId}
                    downloadProgress={downloadProgress}
                    isDownloading={isDownloading}
                    onToggleSelect={toggleSelect}
                    onView={handleView}
                    onDownload={handleDownload}
                    onOpenFolder={handleOpenFolder}
                    onEditGroup={handleEditGroup}
                    onExportAccount={handleExportSingleAccount}
                    onDelete={handleDelete}
                    onStopDownload={onStopDownload}
                  />
                  {hasMore ? (
                    <div className="flex justify-center pt-3">
                      <Button
                        variant="outline"
                        onClick={() => void loadMore()}
                        disabled={loadingMore}
                      >
                        {loadingMore ? "Loading..." : "Load More"}
                      </Button>
                    </div>
                  ) : null}
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {showScrollTop ? (
        <Button
          variant="default"
          size="icon"
          className="fixed bottom-6 left-1/2 z-30 h-9 w-9 -translate-x-1/2 rounded-full shadow-lg"
          onClick={scrollToTop}
        >
          <ArrowUp className="h-4 w-4" />
        </Button>
      ) : null}

      <DatabaseEditGroupDialog
        editingAccount={editingAccount}
        groups={groups}
        editGroupName={editGroupName}
        editGroupColor={editGroupColor}
        onEditGroupNameChange={setEditGroupName}
        onEditGroupColorChange={setEditGroupColor}
        onClose={() => setEditingAccount(null)}
        onSave={handleSaveGroup}
      />
    </div>
  );
}
