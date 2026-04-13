import { startTransition, useCallback, useState, useEffect, useRef, useMemo } from "react";
import { VList } from "virtua";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Checkbox } from "@/components/ui/checkbox";
import { Spinner } from "@/components/ui/spinner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Trash2, FileInput, FileOutput, Pencil, Tag, Shuffle, X, XCircle, Download, StopCircle, Globe, Lock, Bookmark, Heart, Image, Images, Video, Film, FileText, Filter, AlertCircle, MoreVertical, FileBraces, CloudBackup, Search, LayoutGrid, List, ArrowUpDown, ArrowUp, FolderOpen } from "lucide-react";
import { toastWithSound as toast } from "@/lib/toast-with-sound";
import { getSettings } from "@/lib/settings";
import { openExternal } from "@/lib/utils";
import { useSavedAccountsModel } from "@/hooks/useSavedAccountsModel";
import type {
  GlobalDownloadSessionMeta,
  GlobalDownloadState,
} from "@/components/GlobalDownloadPanel";
import {
  GetAllAccountsFromDB,
  DeleteAccountFromDB,
  SaveAccountToDB,
  ExportAccountJSON,
  ExportAccountsTXT,
  UpdateAccountGroup,
  GetAllGroups,
  DownloadSavedScopes,
  CheckFoldersExist,
  OpenFolder,
  GetFolderPath,
} from "../../wailsjs/go/main/App";
import type { HistoryItem } from "@/components/FetchHistory";



function formatNumberWithComma(num: number): string {
  return num.toLocaleString();
}

function getRelativeTime(dateStr: string): string {
  try {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    
    const diffMinutes = Math.floor(diffMs / (1000 * 60));
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    
    if (diffDays > 0) {
      const remainingHours = diffHours % 24;
      return `(${diffDays}d ${remainingHours}h ago)`;
    } else if (diffHours > 0) {
      const remainingMinutes = diffMinutes % 60;
      return `(${diffHours}h ${remainingMinutes}m ago)`;
    } else if (diffMinutes > 0) {
      return `(${diffMinutes}m ago)`;
    } else {
      return "(just now)";
    }
  } catch {
    return "";
  }
}

// Using backend.AccountListItem from wailsjs/go/models
import { backend, main } from "../../wailsjs/go/models";
type AccountListItem = backend.AccountListItem;

interface GroupInfo {
  name: string;
  color: string;
}

interface DatabaseViewProps {
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

function buildScopeRequest(account: AccountListItem) {
  return {
    username: account.username,
    media_type: account.media_type || "all",
    timeline_type: account.timeline_type || "timeline",
    retweets: account.retweets ?? false,
    query_key: account.query_key || "",
  };
}

export function DatabaseView({
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
}: DatabaseViewProps) {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [accounts, setAccounts] = useState<AccountListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [visibleCount, setVisibleCount] = useState(INITIAL_LOAD_COUNT);
  const [showScrollTop, setShowScrollTop] = useState(false);
  const [groups, setGroups] = useState<GroupInfo[]>([]);
  const [filterGroup, setFilterGroup] = useState<string>("all");
  const [filterMediaType, setFilterMediaType] = useState<string>("all");
  const [accountViewMode, setAccountViewMode] = useState<"public" | "private">("public");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [sortOrder, setSortOrder] = useState<"newest" | "oldest" | "username-asc" | "username-desc" | "followers-high" | "followers-low" | "posts-high" | "posts-low" | "media-high" | "media-low">("newest");
  const [gridView, setGridView] = useState<"gallery" | "list">("list");
  const [editingAccount, setEditingAccount] = useState<AccountListItem | null>(null);
  const [editGroupName, setEditGroupName] = useState("");
  const [editGroupColor, setEditGroupColor] = useState("");
  const [clearAllDialogOpen, setClearAllDialogOpen] = useState(false);
  const [isBulkDownloading, setIsBulkDownloading] = useState(false);
  const [bulkDownloadCurrent, setBulkDownloadCurrent] = useState(0);
  const [bulkDownloadTotal, setBulkDownloadTotal] = useState(0);
  const stopBulkDownloadRef = useRef(false);
  const loadMoreRef = useRef<HTMLDivElement>(null);
  const [folderExistence, setFolderExistence] = useState<Map<number, boolean>>(new Map());
  const isDownloading = Boolean(downloadState?.in_progress);
  const downloadingAccountId = downloadState?.in_progress ? downloadMeta?.accountId ?? null : null;
  const downloadProgress = isDownloading ? downloadState : null;

  const resolveAccountFolderName = useCallback((account: AccountListItem) => {
    if (account.username === "bookmarks") {
      return "My Bookmarks";
    }
    if (account.username === "likes") {
      return "My Likes";
    }
    return account.username;
  }, []);

  // Check folder existence for all accounts
  const checkFolderExistence = useCallback(async (accountsList: AccountListItem[]) => {
    const settings = getSettings();
    const basePath = settings.downloadPath;
    if (!basePath || accountsList.length === 0) {
      setFolderExistence(new Map());
      return;
    }

    const folderNames = [...new Set(accountsList.map(resolveAccountFolderName))];
    const existenceByFolder = await CheckFoldersExist(basePath, folderNames);

    const folderMap = new Map<number, boolean>();
    for (const account of accountsList) {
      const folderName = resolveAccountFolderName(account);
      folderMap.set(account.id, Boolean(existenceByFolder[folderName]));
    }

    setFolderExistence(folderMap);
  }, [resolveAccountFolderName]);

  const loadSecondaryData = useCallback(async (accountsList: AccountListItem[]) => {
    try {
      const groupsData = await GetAllGroups();
      if (groupsData) {
        setGroups(groupsData.map((g) => ({ name: g.name || "", color: g.color || "" })));
      }
    } catch (error) {
      console.error("Failed to load groups:", error);
    }

    try {
      const initialAccounts = accountsList.slice(0, INITIAL_LOAD_COUNT);
      await checkFolderExistence(initialAccounts);

      window.setTimeout(() => {
        void checkFolderExistence(accountsList);
      }, 0);
    } catch (error) {
      console.error("Failed to check folder existence:", error);
    }
  }, [checkFolderExistence]);

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

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadAccounts();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadAccounts]);

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

  const isPrivateAccount = useCallback(
    (username: string) => username === "bookmarks" || username === "likes",
    []
  );

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

  const selectedAccounts = useMemo(
    () => filteredAccounts.filter((account) => selectedIds.has(account.id)),
    [filteredAccounts, selectedIds]
  );

  const focusedAccount = selectedAccounts.length === 1 ? selectedAccounts[0] : null;

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
      loadAccounts();
    } catch {
      toast.error("Failed to update group");
    }
  };

  const handleDelete = async (id: number, username: string) => {
    try {
      await DeleteAccountFromDB(id);
      toast.success(`Deleted @${username}`);
      loadAccounts();
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

  const handleOpenFolder = async (username: string) => {
    const settings = getSettings();
    let folderName = username;
    if (username === "bookmarks") {
      folderName = "My Bookmarks";
    } else if (username === "likes") {
      folderName = "My Likes";
    }
    const folderPath = await GetFolderPath(settings.downloadPath, folderName);
    try {
      await OpenFolder(folderPath);
    } catch {
      toast.error("Failed to open folder");
    }
  };

  const handleDownload = async (id: number, username: string) => {
    try {
      const account = accounts.find((entry) => entry.id === id);
      if (!account || account.total_media === 0) {
        toast.error("No media to download");
        return;
      }

      const settings = getSettings();
      onDownloadSessionStart?.({
        source: "database-single",
        title: `Downloading @${account.username}`,
        subtitle: `${formatNumberWithComma(account.total_media)} saved item(s)`,
        accountId: id,
        accountName: account.username,
      });

      const response = await DownloadSavedScopes(new main.DownloadSavedScopesRequest({
        scopes: [buildScopeRequest(account)],
        output_dir: settings.downloadPath || "",
        proxy: settings.proxy || "",
      }));

      if (response.success) {
        const parts: string[] = [];
        if (response.downloaded > 0) {
          parts.push(`${response.downloaded} file${response.downloaded !== 1 ? 's' : ''} downloaded`);
        }
        if (response.skipped > 0) {
          parts.push(`${response.skipped} file${response.skipped !== 1 ? 's' : ''} already exist${response.skipped !== 1 ? '' : 's'}`);
        }
        if (response.failed > 0) {
          parts.push(`${response.failed} failed`);
        }
        const message = parts.length > 0 ? `${parts.join(', ')} for @${username}` : `Download completed for @${username}`;
        
        // Use info toast if only skipped files (no downloaded, no failed)
        if (response.downloaded === 0 && response.failed === 0 && response.skipped > 0) {
          toast.info(message);
        } else {
          toast.success(message);
        }
      } else {
        toast.error(response.message || "Download failed");
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      toast.error(`Download failed: ${errorMsg}`);
    }
  };

  const handleBulkDownload = async () => {
    const idsToDownload = Array.from(selectedIds);
    if (idsToDownload.length === 0) {
      toast.error("No accounts selected");
      return;
    }

    setIsBulkDownloading(true);
    setBulkDownloadTotal(idsToDownload.length);
    setBulkDownloadCurrent(0);
    stopBulkDownloadRef.current = false;

    const settings = getSettings();
    const selectedAccounts = idsToDownload
      .map((id) => accounts.find((account) => account.id === id))
      .filter((account): account is AccountListItem => account !== undefined && account.total_media > 0);

    if (selectedAccounts.length === 0) {
      setIsBulkDownloading(false);
      setBulkDownloadCurrent(0);
      setBulkDownloadTotal(0);
      toast.error("No media to download");
      return;
    }

    const totalItems = selectedAccounts.reduce(
      (sum, account) => sum + account.total_media,
      0
    );

    onDownloadSessionStart?.({
      source: "database-bulk",
      title: `Bulk downloading ${selectedAccounts.length} accounts`,
      subtitle: `${formatNumberWithComma(totalItems)} saved item(s)`,
    });

    let response: Awaited<ReturnType<typeof DownloadSavedScopes>> | null = null;
    try {
      response = await DownloadSavedScopes(new main.DownloadSavedScopesRequest({
        scopes: selectedAccounts.map((account) => buildScopeRequest(account)),
        output_dir: settings.downloadPath || "",
        proxy: settings.proxy || "",
      }));
    } catch (error) {
      console.error("Bulk download failed:", error);
    }

    setIsBulkDownloading(false);
    setBulkDownloadCurrent(0);
    setBulkDownloadTotal(0);

    if (response?.success && (response.downloaded > 0 || response.skipped > 0) && !stopBulkDownloadRef.current) {
      const parts: string[] = [];
      if (response.downloaded > 0) {
        parts.push(`${response.downloaded} file${response.downloaded !== 1 ? 's' : ''} downloaded`);
      }
      if (response.skipped > 0) {
        parts.push(`${response.skipped} file${response.skipped !== 1 ? 's' : ''} already exist${response.skipped !== 1 ? '' : 's'}`);
      }
      const message = parts.length > 0 ? `${parts.join(', ')} from ${selectedAccounts.length} account${selectedAccounts.length !== 1 ? 's' : ''}` : `Download completed from ${selectedAccounts.length} account${selectedAccounts.length !== 1 ? 's' : ''}`;
      
      // Use info toast if only skipped files (no downloaded)
      if (response.downloaded === 0 && response.skipped > 0) {
        toast.info(message);
      } else {
        toast.success(message);
      }
    } else if (response && !response.success && !stopBulkDownloadRef.current) {
      toast.error(response.message || "Bulk download failed");
    }
  };

  const handleStopBulkDownload = async () => {
    stopBulkDownloadRef.current = true;
    await onStopDownload?.();
  };

  const toggleSelect = (id: number) => {
    setSelectedIds((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(id)) {
        newSet.delete(id);
      } else {
        newSet.add(id);
      }
      return newSet;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === filteredAccounts.length && filteredAccounts.length > 0) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredAccounts.map((a) => a.id)));
    }
  };

  const handleExportJSON = async () => {
    const idsToExport = selectedIds.size > 0 ? Array.from(selectedIds) : accounts.map((a) => a.id);

    if (idsToExport.length === 0) {
      toast.error("No accounts to export");
      return;
    }

    const settings = getSettings();
    const outputDir = settings.downloadPath || "";

    try {
      let exported = 0;
      for (const id of idsToExport) {
        await ExportAccountJSON(id, outputDir);
        exported++;
      }
      toast.success(`Exported ${exported} account(s) to ${outputDir}\\twitterxmediabatchdownloader_backups`);
    } catch {
      toast.error("Failed to export");
    }
  };

  const handleExportTXT = async () => {
    const idsToExport = selectedIds.size > 0 ? Array.from(selectedIds) : accounts.map((a) => a.id);

    if (idsToExport.length === 0) {
      toast.error("No accounts to export");
      return;
    }

    const settings = getSettings();
    const outputDir = settings.downloadPath || "";

    try {
      await ExportAccountsTXT(idsToExport, outputDir);
      toast.success(`Exported ${formatNumberWithComma(idsToExport.length)} account(s) to ${outputDir}\\twitterxmediabatchdownloader_backups\\twitterxmediabatchdownloader_multiple.txt`);
    } catch {
      toast.error("Failed to export");
    }
  };

  // Check if any selected accounts are private (bookmarks/likes)
  const hasPrivateAccountSelected = () => {
    if (selectedIds.size === 0) return false;
    return Array.from(selectedIds).some((id) => {
      const account = accounts.find((a) => a.id === id);
      return account && isPrivateAccount(account.username);
    });
  };

  const handleImport = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json";
    input.multiple = true;
    input.onchange = async (e) => {
      const files = (e.target as HTMLInputElement).files;
      if (!files || files.length === 0) return;

      let imported = 0;
      for (const file of Array.from(files)) {
        try {
          const text = await file.text();
          const data = JSON.parse(text);
          
          // Detect media_type from imported file
          let detectedMediaType = "all";
          
          // Check if media_type is explicitly set in the file
          if (data.media_type) {
            detectedMediaType = data.media_type;
          }
          // If not, try to detect from media_list content
          else if (data.media_list && Array.isArray(data.media_list)) {
            const types = new Set(data.media_list.map((item: { media_type?: string; type?: string }) => 
              item.media_type || item.type
            ).filter(Boolean));
            
            // If all items are same type, use that type
            if (types.size === 1) {
              const singleType = Array.from(types)[0] as string;
              if (singleType === "photo") detectedMediaType = "image";
              else if (singleType === "video") detectedMediaType = "video";
              else if (singleType === "animated_gif") detectedMediaType = "gif";
              else detectedMediaType = singleType;
            }
          }
          // Or detect from timeline content
          else if (data.timeline && Array.isArray(data.timeline)) {
            const types = new Set(data.timeline.map((item: { type?: string }) => item.type).filter(Boolean));
            
            // If all items are same type, use that type
            if (types.size === 1) {
              const singleType = Array.from(types)[0] as string;
              if (singleType === "photo") detectedMediaType = "image";
              else if (singleType === "video") detectedMediaType = "video";
              else if (singleType === "animated_gif") detectedMediaType = "gif";
              else if (singleType === "text") detectedMediaType = "text";
              else detectedMediaType = singleType;
            }
          }
          
          // Support new format (account_info + timeline)
          if (data.account_info && data.timeline) {
            await SaveAccountToDB(
              data.account_info.name,  // username/handle
              data.account_info.nick,  // display name
              data.account_info.profile_image,
              data.total_urls || data.timeline.length,
              text,
              detectedMediaType
            );
            imported++;
          }
          // Support legacy format (username + media_list)
          else if (data.username && data.media_list) {
            // Convert legacy format to new format
            const convertedData = {
              account_info: {
                name: data.username,
                nick: data.nick || data.username,
                date: "",
                followers_count: data.followers || 0,
                friends_count: data.following || 0,
                profile_image: data.profile_image || "",
                statuses_count: data.posts || 0,
              },
              total_urls: data.media_list.length,
              timeline: data.media_list.map((item: { url: string; date: string; tweet_id: string; type: string; media_type?: string }) => ({
                url: item.url,
                date: item.date,
                tweet_id: item.tweet_id,
                type: item.media_type || item.type,
                is_retweet: false,
              })),
              metadata: {
                new_entries: data.media_list.length,
                page: 0,
                batch_size: 0,
                has_more: false,
              },
            };
            
            await SaveAccountToDB(
              convertedData.account_info.name,
              convertedData.account_info.nick,
              convertedData.account_info.profile_image,
              convertedData.total_urls,
              JSON.stringify(convertedData),
              detectedMediaType
            );
            imported++;
          }
        } catch (err) {
          console.error(`Failed to import ${file.name}:`, err);
        }
      }
      
      if (imported > 0) {
        toast.success(`Imported ${imported} account(s)`);
        loadAccounts();
      } else {
        toast.error("No valid files imported");
      }
    };
    input.click();
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div ref={scrollContainerRef} className="min-h-0 flex-1 overflow-y-auto pr-1">
        <div className="space-y-4 pb-4">
          <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <h2 className="text-2xl font-bold">Saved Accounts</h2>
          {/* Public/Private Toggle */}
          <div className="flex gap-0.5 p-0.5 bg-muted rounded-lg">
            <button
              type="button"
              onClick={() => setAccountViewMode("public")}
              className={`flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium transition-all ${
                accountViewMode === "public"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Globe className="h-3 w-3" />
              Public ({formatNumberWithComma(publicAccounts.length)})
            </button>
            <button
              type="button"
              onClick={() => setAccountViewMode("private")}
              className={`flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium transition-all ${
                accountViewMode === "private"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Lock className="h-3 w-3" />
              Private ({formatNumberWithComma(privateAccounts.length)})
            </button>
          </div>
        </div>
            <div className="flex flex-wrap items-center gap-2">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="outline" size="icon" onClick={handleImport}>
                <FileInput className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Import JSON</TooltipContent>
          </Tooltip>
          <DropdownMenu>
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="icon" disabled={selectedIds.size === 0}>
                    <FileOutput className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent>Export Selected ({formatNumberWithComma(selectedIds.size)})</TooltipContent>
            </Tooltip>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={handleExportJSON}>
                <FileBraces className="h-4 w-4 mr-2" />
                Export JSON
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleExportTXT} disabled={hasPrivateAccountSelected()}>
                <FileText className="h-4 w-4 mr-2" />
                Export TXT
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button 
                variant="outline" 
                size="icon" 
                onClick={() => {
                  const idsToUpdate = selectedIds.size > 0 ? Array.from(selectedIds) : accounts.map((a) => a.id);
                  if (idsToUpdate.length === 0) {
                    toast.error("No accounts selected");
                    return;
                  }
                  const usernames = idsToUpdate
                    .map((id) => {
                      const account = accounts.find((a) => a.id === id);
                      return account?.username;
                    })
                    .filter((username): username is string => !!username);
                  
                  if (usernames.length === 0) {
                    toast.error("No valid usernames found");
                    return;
                  }
                  
                  if (onUpdateSelected) {
                    onUpdateSelected(usernames);
                    toast.success(`Added ${formatNumberWithComma(usernames.length)} account(s) to multiple fetch`);
                  }
                }}
                disabled={selectedIds.size === 0 || hasPrivateAccountSelected()}
              >
                <CloudBackup className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Update Selected ({formatNumberWithComma(selectedIds.size)})</TooltipContent>
          </Tooltip>
          {isBulkDownloading ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="outline" size="icon" onClick={handleStopBulkDownload}>
                  <StopCircle className="h-4 w-4 text-destructive" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Stop Bulk Download</TooltipContent>
            </Tooltip>
          ) : (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="default" size="icon" onClick={handleBulkDownload} disabled={selectedIds.size === 0 || isDownloading}>
                  <Download className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Download Selected ({formatNumberWithComma(selectedIds.size)})</TooltipContent>
            </Tooltip>
          )}
          <Dialog open={clearAllDialogOpen} onOpenChange={setClearAllDialogOpen}>
            <Tooltip>
              <TooltipTrigger asChild>
                <DialogTrigger asChild>
                  <Button variant="destructive" size="icon" disabled={selectedIds.size === 0}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </DialogTrigger>
              </TooltipTrigger>
              <TooltipContent>Delete Selected ({formatNumberWithComma(selectedIds.size)})</TooltipContent>
            </Tooltip>
            <DialogContent className="[&>button]:hidden">
              <div className="absolute right-4 top-4">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 opacity-70 hover:opacity-100"
                  onClick={() => setClearAllDialogOpen(false)}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
              <DialogHeader>
                <DialogTitle>Delete {formatNumberWithComma(selectedIds.size)} Selected Account{selectedIds.size !== 1 ? 's' : ''}?</DialogTitle>
                <DialogDescription>
                  This will permanently delete the selected account{selectedIds.size !== 1 ? 's' : ''}. This action cannot be undone.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button
                  variant="destructive"
                  onClick={async () => {
                    try {
                      const idsToDelete = Array.from(selectedIds);
                      for (const id of idsToDelete) {
                        await DeleteAccountFromDB(id);
                      }
                      toast.success(`Deleted ${formatNumberWithComma(idsToDelete.length)} account${idsToDelete.length !== 1 ? 's' : ''}`);
                      setClearAllDialogOpen(false);
                      setSelectedIds(new Set());
                      loadAccounts();
                    } catch {
                      toast.error("Failed to delete accounts");
                    }
                  }}
                >
                  Delete {formatNumberWithComma(selectedIds.size)} Account{selectedIds.size !== 1 ? 's' : ''}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
            </div>
          </div>

          {recentFetches.length > 0 ? (
            <div className="rounded-2xl border border-border/70 bg-muted/20 p-3">
              <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
                <div className="space-y-1">
                  <h3 className="text-sm font-semibold">Recent Fetches</h3>
                  <p className="text-xs text-muted-foreground">
                    Reopen a recent username in the fetch workspace without retyping.
                  </p>
                </div>
                {onClearRecentFetches ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 rounded-lg px-2 text-xs"
                    onClick={onClearRecentFetches}
                  >
                    Clear All
                  </Button>
                ) : null}
              </div>

              <div className="flex flex-wrap gap-2">
                {recentFetches.map((item) => (
                  <div
                    key={item.id}
                    className="flex items-center gap-2 rounded-full border border-border/70 bg-card px-2.5 py-1.5 shadow-sm"
                  >
                    {item.image ? (
                      <img
                        src={item.image}
                        alt={item.name}
                        className="h-6 w-6 rounded-full"
                        loading="lazy"
                      />
                    ) : (
                      <div className="flex h-6 w-6 items-center justify-center rounded-full bg-muted text-[11px] font-semibold uppercase text-muted-foreground">
                        {item.username.charAt(0)}
                      </div>
                    )}

                    <button
                      type="button"
                      className="min-w-0 text-left"
                      onClick={() => onSelectRecentFetch?.(item)}
                    >
                      <p className="truncate text-sm font-medium leading-none">@{item.username}</p>
                      <p className="mt-1 text-[11px] leading-none text-muted-foreground">
                        {formatNumberWithComma(item.mediaCount)} items
                      </p>
                    </button>

                    {onRemoveRecentFetch ? (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 rounded-full"
                        onClick={() => onRemoveRecentFetch(item.id)}
                      >
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {loading ? (
            <div className="py-12 text-center text-muted-foreground">Loading...</div>
          ) : accounts.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground">
              No saved accounts yet. Fetch a user's media to save it here.
            </div>
          ) : (
            <div className="space-y-2">
          {/* Row 1: Select All + Search Bar (Search only for public) */}
          <div className="flex items-center gap-4 py-2">
            <div className="flex items-center gap-2">
              <Checkbox
                checked={selectedIds.size === filteredAccounts.length && filteredAccounts.length > 0}
                onCheckedChange={toggleSelectAll}
              />
              <span className="text-sm text-muted-foreground">
                Select all {selectedIds.size > 0 && `(${formatNumberWithComma(selectedIds.size)} selected)`}
              </span>
            </div>
            
            {/* Search Bar - Only show for public accounts */}
            {accountViewMode === "public" && (
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search..."
                  value={searchQuery}
                  onChange={(e) => {
                    setSearchQuery(e.target.value);
                  }}
                  className="pl-9 h-9"
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => {
                      setSearchQuery("");
                    }}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    <XCircle className="h-4 w-4" />
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Row 2: Sort, Filters, View Toggle */}
          <div className="flex items-center gap-2 pb-2">
            {/* Sort Order - only for public accounts */}
            {accountViewMode === "public" && (
              <Select value={sortOrder} onValueChange={(v) => setSortOrder(v as typeof sortOrder)}>
                <SelectTrigger className="w-auto">
                  <ArrowUpDown className="h-4 w-4 mr-2" />
                  <SelectValue placeholder="Sort" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="newest">Newest</SelectItem>
                  <SelectItem value="oldest">Oldest</SelectItem>
                  <SelectItem value="username-asc">Username (A-Z)</SelectItem>
                  <SelectItem value="username-desc">Username (Z-A)</SelectItem>
                  <SelectItem value="followers-high">Followers (High-Low)</SelectItem>
                  <SelectItem value="followers-low">Followers (Low-High)</SelectItem>
                  <SelectItem value="posts-high">Posts (High-Low)</SelectItem>
                  <SelectItem value="posts-low">Posts (Low-High)</SelectItem>
                  <SelectItem value="media-high">Media Count (High-Low)</SelectItem>
                  <SelectItem value="media-low">Media Count (Low-High)</SelectItem>
                </SelectContent>
              </Select>
            )}
            
            {/* Media Type Filter - only for public accounts */}
            {accountViewMode === "public" && (
              <Select value={filterMediaType} onValueChange={setFilterMediaType}>
                <SelectTrigger className="w-auto">
                  <Filter className="h-4 w-4 mr-2" />
                  <SelectValue placeholder="Filter by type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">
                    <span className="flex items-center gap-2">All Types</span>
                  </SelectItem>
                  <SelectItem value="all-media">
                    <span className="flex items-center gap-2">
                      <Images className="h-4 w-4 text-indigo-500" />
                      All Media
                    </span>
                  </SelectItem>
                  <SelectItem value="image">
                    <span className="flex items-center gap-2">
                      <Image className="h-4 w-4 text-blue-500" />
                      Images
                    </span>
                  </SelectItem>
                  <SelectItem value="video">
                    <span className="flex items-center gap-2">
                      <Video className="h-4 w-4 text-purple-500" />
                      Videos
                    </span>
                  </SelectItem>
                  <SelectItem value="gif">
                    <span className="flex items-center gap-2">
                      <Film className="h-4 w-4 text-green-500" />
                      GIFs
                    </span>
                  </SelectItem>
                  <SelectItem value="text">
                    <span className="flex items-center gap-2">
                      <FileText className="h-4 w-4 text-orange-500" />
                      Text
                    </span>
                  </SelectItem>
                </SelectContent>
              </Select>
            )}

            {/* Group Filter - only for public accounts */}
            {accountViewMode === "public" && (
              <Select value={filterGroup} onValueChange={setFilterGroup} disabled={groups.length === 0}>
                <SelectTrigger className="w-auto">
                  <Tag className="h-4 w-4 mr-2" />
                  <SelectValue placeholder="Filter by group" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Groups</SelectItem>
                  <SelectItem value="ungrouped">Ungrouped</SelectItem>
                  {groups.map((group) => (
                    <SelectItem key={group.name} value={group.name}>
                      <span className="flex items-center gap-2">
                        <span
                          className="w-3 h-3 rounded-full"
                          style={{ backgroundColor: group.color }}
                        />
                        {group.name}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}

            <div className="flex-1" />

            {/* Grid View Toggle - only for public accounts */}
            {accountViewMode === "public" && (
              <div className="flex items-center border rounded-md">
                <Button
                  variant={gridView === "gallery" ? "secondary" : "ghost"}
                  size="icon"
                  className="h-10 w-10 rounded-r-none"
                  onClick={() => setGridView("gallery")}
                  aria-label="Show gallery view"
                >
                  <LayoutGrid className="h-4 w-4" />
                </Button>
                <Button
                  variant={gridView === "list" ? "secondary" : "ghost"}
                  size="icon"
                  className="h-10 w-10 rounded-l-none border-l"
                  onClick={() => setGridView("list")}
                  aria-label="Show list view"
                >
                  <List className="h-4 w-4" />
                </Button>
              </div>
            )}
          </div>

          {selectedAccounts.length > 0 ? (
            <div className="rounded-2xl border border-border/70 bg-muted/20 p-4">
              {focusedAccount ? (
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                      Selected Account
                    </p>
                    <div className="mt-2 flex items-center gap-3">
                      {isPrivateAccount(focusedAccount.username) ? (
                        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
                          {focusedAccount.username === "bookmarks" ? (
                            <Bookmark className="h-5 w-5 text-primary" />
                          ) : (
                            <Heart className="h-5 w-5 text-primary" />
                          )}
                        </div>
                      ) : (
                        <img
                          src={focusedAccount.profile_image}
                          alt={focusedAccount.name}
                          className="h-12 w-12 rounded-full"
                          loading="lazy"
                        />
                      )}
                      <div className="min-w-0">
                        <p className="truncate text-lg font-semibold">{focusedAccount.name}</p>
                        <p className="truncate text-sm text-muted-foreground">
                          @{focusedAccount.username}
                        </p>
                      </div>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Badge variant="secondary">
                        {formatNumberWithComma(focusedAccount.total_media)} items
                      </Badge>
                      <Badge variant="secondary">
                        {focusedAccount.media_type || "all"}
                      </Badge>
                      {!focusedAccount.completed ? (
                        <Badge className="bg-yellow-500/20 text-yellow-700 dark:text-yellow-300">
                          Incomplete
                        </Badge>
                      ) : null}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      className="h-10 rounded-xl"
                      onClick={() => handleView(focusedAccount)}
                    >
                      View
                    </Button>
                    <Button
                      className="h-10 rounded-xl"
                      onClick={() => handleDownload(focusedAccount.id, focusedAccount.username)}
                      disabled={isDownloading}
                    >
                      <Download className="h-4 w-4" />
                      Download
                    </Button>
                    <Button
                      variant="outline"
                      className="h-10 rounded-xl"
                      onClick={() => handleOpenFolder(focusedAccount.username)}
                      disabled={!folderExistence.get(focusedAccount.id)}
                    >
                      <FolderOpen className="h-4 w-4" />
                      Open Folder
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                      Selection Summary
                    </p>
                    <p className="mt-1 text-lg font-semibold">
                      {formatNumberWithComma(selectedAccounts.length)} account(s) selected
                    </p>
                    <p className="text-sm text-muted-foreground">
                      Bulk download, export, and update actions will use this selection.
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      className="h-10 rounded-xl"
                      onClick={handleExportJSON}
                    >
                      <FileOutput className="h-4 w-4" />
                      Export JSON
                    </Button>
                    <Button
                      className="h-10 rounded-xl"
                      onClick={handleBulkDownload}
                      disabled={isDownloading}
                    >
                      <Download className="h-4 w-4" />
                      Download Selected
                    </Button>
                  </div>
                </div>
              )}
            </div>
          ) : null}

          {/* Bulk Download Progress */}
          {isBulkDownloading && (
            <div className="px-4 py-3 bg-muted/50 rounded-lg space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">
                  Downloading account {bulkDownloadCurrent} of {bulkDownloadTotal}
                </span>
                <span className="font-medium">{Math.round((bulkDownloadCurrent / bulkDownloadTotal) * 100)}%</span>
              </div>
              <Progress value={(bulkDownloadCurrent / bulkDownloadTotal) * 100} className="h-2" />
            </div>
          )}

          {/* Grid View: Large */}
          {gridView === "gallery" && (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
              {filteredAccounts
                .slice(0, visibleCount)
                .map((account) => (
                <div
                  key={account.id}
                  className={`relative rounded-lg border transition-colors p-4 ${
                    selectedIds.has(account.id) ? "border-primary bg-primary/5" : "bg-card hover:bg-muted/50"
                  }`}
                >
                  {/* Checkbox - Top Left */}
                  <Checkbox
                    checked={selectedIds.has(account.id)}
                    onCheckedChange={() => toggleSelect(account.id)}
                    className="absolute top-2 left-2 z-10"
                  />
                  {/* Media Type Badge - Top Right */}
                  <div className="absolute top-2 right-2 z-10 flex gap-1">
                    <Badge
                      variant="secondary"
                      className={cn(
                        "text-xs flex items-center gap-1",
                        account.media_type === "text" && "bg-orange-500/20 text-orange-600 dark:text-orange-400",
                        account.media_type === "image" && "bg-blue-500/20 text-blue-600 dark:text-blue-400",
                        account.media_type === "video" && "bg-purple-500/20 text-purple-600 dark:text-purple-400",
                        account.media_type === "gif" && "bg-green-500/20 text-green-600 dark:text-green-400",
                        (!account.media_type || account.media_type === "all") && "bg-indigo-500/20 text-indigo-600 dark:text-indigo-400"
                      )}
                    >
                      {account.media_type === "text" ? <FileText className="h-3 w-3" /> :
                       account.media_type === "image" ? <Image className="h-3 w-3" /> :
                       account.media_type === "video" ? <Video className="h-3 w-3" /> :
                       account.media_type === "gif" ? <Film className="h-3 w-3" /> :
                       <Images className="h-3 w-3" />}
                    </Badge>
                    {!account.completed && (
                      <Badge variant="secondary" className="text-xs bg-yellow-500/20 text-yellow-600 dark:text-yellow-400">
                        <AlertCircle className="h-3 w-3" />
                      </Badge>
                    )}
                  </div>
                  <div className="flex flex-col items-center text-center gap-3 pt-4">
                    {isPrivateAccount(account.username) ? (
                      <div 
                        className="w-20 h-20 rounded-full bg-primary/10 flex items-center justify-center cursor-pointer hover:bg-primary/20 transition-colors"
                        onClick={() => handleView(account)}
                      >
                        {account.username === "bookmarks" ? (
                          <Bookmark className="h-10 w-10 text-primary" />
                        ) : (
                          <Heart className="h-10 w-10 text-primary" />
                        )}
                      </div>
                    ) : (
                      <img
                        src={account.profile_image}
                        alt={account.name}
                        className="w-20 h-20 rounded-full cursor-pointer hover:opacity-80 transition-opacity"
                        onClick={() => handleView(account)}
                      />
                    )}
                    <div className="w-full min-w-0">
                      <div className="font-medium truncate">{account.name}</div>
                      {!isPrivateAccount(account.username) && (
                        <button
                          type="button"
                          onClick={() => openExternal(`https://x.com/${account.username}`)}
                          className="text-sm text-muted-foreground hover:text-primary hover:underline"
                        >
                          @{account.username}
                        </button>
                      )}
                      <div className="text-sm text-muted-foreground mt-1">
                        {formatNumberWithComma(account.total_media)} media
                      </div>
                    </div>
                    <div className="flex gap-1">
                      {downloadingAccountId === account.id ? (
                        <Button
                          variant="outline"
                          size="icon"
                          className="h-8 w-8"
                          onClick={onStopDownload}
                        >
                          <StopCircle className="h-4 w-4 text-destructive" />
                        </Button>
                      ) : (
                        <Button
                          variant="default"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => handleDownload(account.id, account.username)}
                          disabled={isDownloading}
                        >
                          <Download className="h-4 w-4" />
                        </Button>
                      )}
                      <Button
                        variant="outline"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => handleOpenFolder(account.username)}
                        disabled={!folderExistence.get(account.id)}
                      >
                        <FolderOpen className="h-4 w-4" />
                      </Button>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="outline" size="icon" className="h-8 w-8">
                            <MoreVertical className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          {!isPrivateAccount(account.username) && (
                            <DropdownMenuItem onClick={() => handleEditGroup(account)}>
                              <Pencil className="h-4 w-4 mr-2" />
                              Edit Group
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuItem
                            onClick={async () => {
                              const settings = getSettings();
                              const outputDir = settings.downloadPath || "";
                              try {
                                await ExportAccountJSON(account.id, outputDir);
                                toast.success(`Exported @${account.username}`);
                              } catch {
                                toast.error("Failed to export");
                              }
                            }}
                          >
                            <FileOutput className="h-4 w-4 mr-2" />
                            Export JSON
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => handleDelete(account.id, account.username)}
                            className="text-destructive focus:text-destructive"
                          >
                            <Trash2 className="h-4 w-4 mr-2" />
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>
                  {/* Progress bar */}
                  {downloadingAccountId === account.id && downloadProgress && (
                    <div className="mt-3 space-y-1">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-muted-foreground">
                          {downloadProgress.current}/{downloadProgress.total}
                        </span>
                        <span className="font-medium">{downloadProgress.percent}%</span>
                      </div>
                      <Progress value={downloadProgress.percent} className="h-1.5" />
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* List View */}
          {gridView === "list" && (
            <VList
              data={filteredAccounts}
              style={{ height: "68vh" }}
              className="rounded-2xl border border-border/70 bg-background/40"
            >
              {(account, index) => (
                <div
                  key={account.id}
                  className={cn(
                    "border-b border-border/60 px-4 py-3 transition-colors",
                    selectedIds.has(account.id) ? "bg-primary/6" : "hover:bg-muted/35"
                  )}
                >
                  <div className="flex items-center gap-4">
                    <Checkbox
                      checked={selectedIds.has(account.id)}
                      onCheckedChange={() => toggleSelect(account.id)}
                    />
                    <span className="w-8 shrink-0 text-center text-sm text-muted-foreground">
                      {index + 1}
                    </span>
                    <Button
                      variant="ghost"
                      className="h-auto rounded-full p-0 hover:bg-transparent"
                      onClick={() => handleView(account)}
                      aria-label={`Open saved account ${account.username}`}
                    >
                      {isPrivateAccount(account.username) ? (
                        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
                          {account.username === "bookmarks" ? (
                            <Bookmark className="h-6 w-6 text-primary" />
                          ) : (
                            <Heart className="h-6 w-6 text-primary" />
                          )}
                        </div>
                      ) : (
                        <img
                          src={account.profile_image}
                          alt={account.name}
                          className="h-12 w-12 rounded-full"
                          loading="lazy"
                        />
                      )}
                    </Button>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="truncate font-medium">{account.name}</span>
                        <Badge variant="secondary" className="text-xs flex items-center gap-1">
                          <Images className="h-3 w-3" />
                          {formatNumberWithComma(account.total_media)}
                        </Badge>
                        {!account.completed ? (
                          <Badge className="bg-yellow-500/20 text-yellow-700 dark:text-yellow-300">
                            Incomplete
                          </Badge>
                        ) : null}
                        {account.group_name ? (
                          <Badge
                            variant="outline"
                            className="text-xs"
                            style={{ borderColor: account.group_color, color: account.group_color }}
                          >
                            {account.group_name}
                          </Badge>
                        ) : null}
                      </div>
                      {!isPrivateAccount(account.username) ? (
                        <button
                          type="button"
                          onClick={() => openExternal(`https://x.com/${account.username}`)}
                          className="text-sm text-muted-foreground hover:text-primary hover:underline"
                        >
                          @{account.username}
                        </button>
                      ) : (
                        <p className="text-sm text-muted-foreground">
                          {account.username === "bookmarks" ? "My Bookmarks" : "My Likes"}
                        </p>
                      )}
                      <p className="text-sm text-muted-foreground">
                        {account.last_fetched} {getRelativeTime(account.last_fetched)}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {downloadingAccountId === account.id ? (
                        <Button
                          variant="outline"
                          size="icon"
                          onClick={onStopDownload}
                          aria-label={`Stop download for ${account.username}`}
                        >
                          <StopCircle className="h-4 w-4 text-destructive" />
                        </Button>
                      ) : (
                        <Button
                          variant="default"
                          size="icon"
                          onClick={() => handleDownload(account.id, account.username)}
                          disabled={isDownloading}
                          aria-label={`Download saved media for ${account.username}`}
                        >
                          {isDownloading && downloadingAccountId === account.id ? (
                            <Spinner className="h-4 w-4" />
                          ) : (
                            <Download className="h-4 w-4" />
                          )}
                        </Button>
                      )}
                      <Button
                        variant="outline"
                        size="icon"
                        onClick={() => handleOpenFolder(account.username)}
                        disabled={!folderExistence.get(account.id)}
                        aria-label={`Open download folder for ${account.username}`}
                      >
                        <FolderOpen className="h-4 w-4" />
                      </Button>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="outline" size="icon" aria-label={`More actions for ${account.username}`}>
                            <MoreVertical className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          {!isPrivateAccount(account.username) ? (
                            <DropdownMenuItem onClick={() => handleEditGroup(account)}>
                              <Pencil className="mr-2 h-4 w-4" />
                              Edit Group
                            </DropdownMenuItem>
                          ) : null}
                          <DropdownMenuItem
                            onClick={async () => {
                              const settings = getSettings();
                              const outputDir = settings.downloadPath || "";
                              try {
                                await ExportAccountJSON(account.id, outputDir);
                                toast.success(`Exported @${account.username}`);
                              } catch {
                                toast.error("Failed to export");
                              }
                            }}
                          >
                            <FileOutput className="mr-2 h-4 w-4" />
                            Export JSON
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            className="text-destructive focus:text-destructive"
                            onClick={() => handleDelete(account.id, account.username)}
                          >
                            <Trash2 className="mr-2 h-4 w-4" />
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>
                  {downloadingAccountId === account.id && downloadProgress ? (
                    <div className="mt-3 space-y-1">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-muted-foreground">
                          Downloading {downloadProgress.current} of {downloadProgress.total}
                        </span>
                        <span className="font-medium">{downloadProgress.percent}%</span>
                      </div>
                      <Progress value={downloadProgress.percent} className="h-1.5" />
                    </div>
                  ) : null}
                </div>
              )}
            </VList>
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

      {/* Edit Group Dialog */}
      <Dialog open={!!editingAccount} onOpenChange={(open) => !open && setEditingAccount(null)}>
        <DialogContent className="[&>button]:hidden">
          <div className="absolute right-4 top-4">
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 opacity-70 hover:opacity-100"
              onClick={() => setEditingAccount(null)}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
          <DialogHeader>
            <DialogTitle>Edit Group for @{editingAccount?.username}</DialogTitle>
            <DialogDescription>
              Assign this account to a group for better organization.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="groupName">Group Name</Label>
              <div className="flex items-center gap-2">
                <Input
                  id="groupName"
                  placeholder="e.g., Artists, Photographers, Friends"
                  value={editGroupName}
                  onChange={(e) => setEditGroupName(e.target.value)}
                  className="flex-1"
                />
                {groups.length > 0 && (
                  <Select
                    value=""
                    onValueChange={(value) => {
                      setEditGroupName(value);
                      const group = groups.find((g) => g.name === value);
                      if (group) setEditGroupColor(group.color);
                    }}
                  >
                    <SelectTrigger className="w-auto">
                      <Tag className="h-4 w-4" />
                    </SelectTrigger>
                    <SelectContent>
                      {groups.map((g) => (
                        <SelectItem key={g.name} value={g.name}>
                          <span className="flex items-center gap-2">
                            <span
                              className="w-3 h-3 rounded-full"
                              style={{ backgroundColor: g.color }}
                            />
                            {g.name}
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
                {editGroupName && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="outline"
                        size="icon"
                        onClick={() => {
                          setEditGroupName("");
                          setEditGroupColor("#3b82f6");
                        }}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Remove from Group</TooltipContent>
                  </Tooltip>
                )}
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="groupColor">Group Color</Label>
              <div className="flex items-center gap-3">
                <div className="relative w-10 h-10">
                  <input
                    id="groupColor"
                    type="color"
                    value={editGroupColor}
                    onChange={(e) => setEditGroupColor(e.target.value)}
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                  />
                  <div
                    className="w-10 h-10 rounded-full border-2 border-border cursor-pointer"
                    style={{ backgroundColor: editGroupColor }}
                  />
                </div>
                <Input
                  value={editGroupColor}
                  onChange={(e) => setEditGroupColor(e.target.value)}
                  placeholder="#3b82f6"
                  className="w-28 font-mono text-sm"
                />
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={() => {
                        const randomColor = "#" + Math.floor(Math.random() * 16777215).toString(16).padStart(6, "0");
                        setEditGroupColor(randomColor);
                      }}
                    >
                      <Shuffle className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Random Color</TooltipContent>
                </Tooltip>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingAccount(null)}>
              Cancel
            </Button>
            <Button onClick={handleSaveGroup}>
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
