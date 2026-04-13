import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { ArrowUp } from "lucide-react";
import { DatabaseAccountsGallery } from "@/components/database/DatabaseAccountsGallery";
import { DatabaseAccountsList } from "@/components/database/DatabaseAccountsList";
import { DatabaseBulkProgress } from "@/components/database/DatabaseBulkProgress";
import { DatabaseEditGroupDialog } from "@/components/database/DatabaseEditGroupDialog";
import { DatabaseFiltersBar } from "@/components/database/DatabaseFiltersBar";
import { DatabaseHeaderBar } from "@/components/database/DatabaseHeaderBar";
import { DatabaseRecentFetches } from "@/components/database/DatabaseRecentFetches";
import { DatabaseSelectionSummary } from "@/components/database/DatabaseSelectionSummary";
import type {
  AccountListItem,
  DatabaseGridView,
  DatabaseSortOrder,
} from "@/types/database";
import { useSavedAccountsModel } from "@/hooks/saved/useSavedAccountsModel";
import { useDatabaseActions } from "@/hooks/database/useDatabaseActions";
import { useDatabaseAccountsData } from "@/hooks/database/useDatabaseAccountsData";
import { useDatabaseSelectionState } from "@/hooks/database/useDatabaseSelectionState";
import type {
  GlobalDownloadSessionMeta,
  GlobalDownloadState,
} from "@/types/download";
import type { HistoryItem } from "@/types/fetch";

interface DatabaseWorkspaceProps {
  onLoadAccount: (account: AccountListItem) => void | Promise<void>;
  onUpdateSelected?: (usernames: string[]) => void;
  downloadState?: GlobalDownloadState | null;
  downloadMeta?: GlobalDownloadSessionMeta | null;
  onStopDownload?: () => void | Promise<void>;
  onDownloadSessionStart?: (meta: GlobalDownloadSessionMeta) => void;
  recentFetches?: HistoryItem[];
  onSelectRecentFetch?: (item: HistoryItem) => void;
  onRemoveRecentFetch?: (id: string) => void;
  onClearRecentFetches?: () => void;
}

const INITIAL_LOAD_COUNT = 12;
const LOAD_MORE_COUNT = 12;

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
  const [visibleCount, setVisibleCount] = useState(INITIAL_LOAD_COUNT);
  const [showScrollTop, setShowScrollTop] = useState(false);
  const [filterGroup, setFilterGroup] = useState<string>("all");
  const [filterMediaType, setFilterMediaType] = useState<string>("all");
  const [accountViewMode, setAccountViewMode] = useState<"public" | "private">("public");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [sortOrder, setSortOrder] = useState<DatabaseSortOrder>("newest");
  const [gridView, setGridView] = useState<DatabaseGridView>("list");
  const loadMoreRef = useRef<HTMLDivElement>(null);
  const downloadingAccountId = downloadState?.in_progress ? downloadMeta?.accountId ?? null : null;
  const downloadProgress = downloadState?.in_progress ? downloadState : null;
  const {
    accounts,
    loading,
    groups,
    folderExistence,
    loadAccounts,
    refreshFolderExistence,
  } = useDatabaseAccountsData();

  // Reset visible count when grid view or filters change
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setVisibleCount(INITIAL_LOAD_COUNT);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [gridView, searchQuery, filterGroup, filterMediaType, accountViewMode, sortOrder]);

  // Listen for scroll to show/hide scroll-to-top button
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

  const scrollToTop = () => {
    scrollContainerRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  };

  const {
    publicAccounts,
    privateAccounts,
    filteredAccounts,
  } = useSavedAccountsModel({
    accounts,
    accountViewMode,
    searchQuery,
    filterGroup,
    filterMediaType,
    sortOrder,
  });

  const {
    selectedIds,
    setSelectedIds,
    selectedAccounts,
    focusedAccount,
    toggleSelect,
    toggleSelectAll,
  } = useDatabaseSelectionState(filteredAccounts);

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
    selectedIds,
    setSelectedIds,
    loadAccounts,
    refreshFolderExistence,
    onLoadAccount,
    onUpdateSelected,
    onStopDownload,
    onDownloadSessionStart,
    downloadState,
  });

  // Intersection Observer for lazy loading
  useEffect(() => {
    if (gridView !== "gallery") {
      return;
    }

    const currentRef = loadMoreRef.current;
    if (!currentRef) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          setVisibleCount((prev) => Math.min(prev + LOAD_MORE_COUNT, filteredAccounts.length));
        }
      },
      { threshold: 0.1, rootMargin: "100px" }
    );

    observer.observe(currentRef);

    return () => {
      observer.unobserve(currentRef);
    };
  }, [filteredAccounts.length, gridView, loading]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div ref={scrollContainerRef} className="min-h-0 flex-1 overflow-y-auto pr-1">
        <div className="space-y-4 pb-4">
          <DatabaseHeaderBar
            accountViewMode={accountViewMode}
            onAccountViewModeChange={setAccountViewMode}
            publicCount={publicAccounts.length}
            privateCount={privateAccounts.length}
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
          ) : accounts.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground">
              No saved accounts yet. Fetch a user's media to save it here.
            </div>
          ) : (
            <div className="space-y-2">
          <DatabaseFiltersBar
            accountViewMode={accountViewMode}
            selectedCount={selectedIds.size}
            allVisibleSelected={
              selectedIds.size === filteredAccounts.length && filteredAccounts.length > 0
            }
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
            focusedAccount={focusedAccount}
            folderExistence={folderExistence}
            isDownloading={isDownloading}
            onView={handleView}
            onDownload={handleDownload}
            onOpenFolder={handleOpenFolder}
            onExportJSON={handleExportJSON}
            onBulkDownload={handleBulkDownload}
          />

          {/* Bulk Download Progress */}
          {isBulkDownloading ? (
            <DatabaseBulkProgress
              current={bulkDownloadCurrent}
              total={bulkDownloadTotal}
            />
          ) : null}

          {gridView === "gallery" && (
            <DatabaseAccountsGallery
              accounts={filteredAccounts.slice(0, visibleCount)}
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
          )}

          {gridView === "list" && (
            <DatabaseAccountsList
              accounts={filteredAccounts}
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
          )}

          {/* Load More Trigger (invisible) */}
          <div
            ref={loadMoreRef}
            className={`h-4 ${gridView !== "gallery" || visibleCount >= filteredAccounts.length ? "hidden" : ""}`}
          />
            </div>
          )}
        </div>
      </div>

      {/* Scroll to Top Button */}
      {showScrollTop && (
        <Button
          variant="default"
          size="icon"
          className="fixed bottom-6 left-1/2 -translate-x-1/2 h-9 w-9 rounded-full shadow-lg z-30"
          onClick={scrollToTop}
        >
          <ArrowUp className="h-4 w-4" />
        </Button>
      )}

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
