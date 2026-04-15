import { lazy, Suspense, useState, useCallback, useEffect } from "react";
import { getSettings, syncSettingsSnapshot, SETTINGS_CHANGED_EVENT, type Settings } from "@/lib/settings";
import { APP_VERSION } from "@/lib/app-info";
import { toastWithSound as toast } from "@/lib/toast-with-sound";
import { logger } from "@/lib/logger";
import { type FetchScope } from "@/lib/fetch/state";

// Components
import { ActivityPanel } from "@/components/workspace/ActivityPanel";
import { FetchWorkspaceLayout } from "@/components/workspace/FetchWorkspaceLayout";
import { SavedWorkspaceLayout } from "@/components/workspace/SavedWorkspaceLayout";
import { WorkspaceChrome } from "@/components/workspace/WorkspaceChrome";
import { DesktopSmokeDriver } from "@/components/workspace/DesktopSmokeDriver";
import { WorkspaceDrawers } from "@/components/workspace/WorkspaceDrawers";
import { WorkspaceLoadingState } from "@/components/workspace/WorkspaceLoadingState";
import { WorkspaceRouter } from "@/components/workspace/WorkspaceRouter";
import { FetchWorkspaceSidebar } from "@/components/workspace/fetch/FetchWorkspaceSidebar";
import { MultiAccountWorkspace } from "@/components/workspace/fetch/MultiAccountWorkspace";
import { TaskHistoryWorkspace } from "@/components/workspace/history/TaskHistoryWorkspace";
import type { FetchType } from "@/types/fetch";
import { useActivityPanelState } from "@/hooks/workspace/useActivityPanelState";
import {
  formatNumberWithComma,
  parseUsernameList,
  resolveFetchTimelineType,
} from "@/lib/fetch/session";
import { useSingleFetchController } from "@/hooks/fetch/useSingleFetchController";
import { useMultiFetchController } from "@/hooks/fetch/useMultiFetchController";
import { useFetchHistory } from "@/hooks/fetch/useFetchHistory";
import { useFetchTaskHistory } from "@/hooks/history/useFetchTaskHistory";
import { useFetchWorkspaceCoordinator } from "@/hooks/workspace/useFetchWorkspaceCoordinator";
import { useGlobalDownloadMonitor } from "@/hooks/download/useGlobalDownloadMonitor";
import { useGlobalIntegrityMonitor } from "@/hooks/integrity/useGlobalIntegrityMonitor";
import { useWorkspaceChromeState } from "@/hooks/workspace/useWorkspaceChromeState";
import { useWorkspaceSettingsState } from "@/hooks/workspace/useWorkspaceSettingsState";
import type { DiagnosticsParityContext } from "@/types/diagnostics";

// Wails bindings
import { DownloadSavedScopes } from "../wailsjs/go/main/App";
import { backend, main } from "../wailsjs/go/models";

const MediaWorkspace = lazy(() =>
  import("@/components/media/MediaWorkspace").then((module) => ({ default: module.MediaWorkspace }))
);
const DatabaseWorkspace = lazy(() =>
  import("@/components/database/DatabaseWorkspace").then((module) => ({ default: module.DatabaseWorkspace }))
);
const SavedTimelineWorkspace = lazy(() =>
  import("@/components/saved-timeline/SavedTimelineWorkspace").then((module) => ({ default: module.SavedTimelineWorkspace }))
);
const SettingsPanel = lazy(() =>
  import("@/components/workspace/SettingsPanel").then((module) => ({ default: module.SettingsPanel }))
);
const DiagnosticsPanel = lazy(() =>
  import("@/components/workspace/DiagnosticsPanel").then((module) => ({ default: module.DiagnosticsPanel }))
);

function buildDiagnosticsParityContext(options: {
  username: string;
  fetchType: FetchType;
  searchMode: "public" | "private";
  searchPrivateType: "bookmarks" | "likes";
  publicAuthToken: string;
  privateAuthToken: string;
  useDateRange: boolean;
  startDate: string;
  endDate: string;
  settings: Settings;
}): DiagnosticsParityContext {
  const effectiveMediaType = options.settings.mediaType || "all";
  const effectiveRetweets = Boolean(options.settings.includeRetweets);

  if (options.fetchType !== "single") {
    return {
      enabled: false,
      request_kind: null,
      summary_label: "Single-account parity only",
      disabled_reason: "Parity is only available for the current single-account fetch context.",
    };
  }

  if (options.searchMode === "private" && options.searchPrivateType === "bookmarks") {
    if (!options.privateAuthToken.trim()) {
      return {
        enabled: false,
        request_kind: null,
        summary_label: `Private bookmarks · ${effectiveMediaType}`,
        disabled_reason: "Private auth token is required to run bookmarks parity.",
      };
    }

    return {
      enabled: true,
      request_kind: "timeline",
      summary_label: `Private bookmarks · ${effectiveMediaType}`,
      scope: "private",
      timeline_request: {
        username: "",
        auth_token: options.privateAuthToken.trim(),
        timeline_type: "bookmarks",
        batch_size: 0,
        page: 0,
        media_type: effectiveMediaType,
        retweets: effectiveRetweets,
      },
    };
  }

  const usernames = parseUsernameList(options.username);
  if (usernames.length === 0) {
    return {
      enabled: false,
      request_kind: null,
      summary_label: "No active fetch target",
      disabled_reason: "Enter a username to run extractor parity.",
    };
  }
  if (usernames.length > 1) {
    return {
      enabled: false,
      request_kind: null,
      summary_label: "Multiple usernames detected",
      disabled_reason: "Parity only supports one username at a time.",
    };
  }

  const singleUsername = usernames[0];
  const authToken =
    options.searchMode === "private" ? options.privateAuthToken.trim() : options.publicAuthToken.trim();
  if (!authToken) {
    return {
      enabled: false,
      request_kind: null,
      summary_label:
        options.searchMode === "private"
          ? `Private ${options.searchPrivateType} @${singleUsername}`
          : `Public @${singleUsername}`,
      disabled_reason: "An auth token is required to run extractor parity.",
    };
  }

  if (options.useDateRange) {
    if (options.searchMode !== "public") {
      return {
        enabled: false,
        request_kind: null,
        summary_label: `Private @${singleUsername}`,
        disabled_reason: "Date-range parity is only available for public fetches.",
      };
    }
    if (!options.startDate || !options.endDate) {
      return {
        enabled: false,
        request_kind: null,
        summary_label: `Public @${singleUsername} date range`,
        disabled_reason: "Start and end dates are required to run date-range parity.",
      };
    }

    return {
      enabled: true,
      request_kind: "date_range",
      summary_label: `Public @${singleUsername} · ${options.startDate}..${options.endDate} · ${effectiveMediaType}`,
      scope: "public",
      date_range_request: {
        username: singleUsername,
        auth_token: authToken,
        start_date: options.startDate,
        end_date: options.endDate,
        media_filter: effectiveMediaType,
        retweets: effectiveRetweets,
      },
    };
  }

  const timelineType = resolveFetchTimelineType(
    false,
    options.searchMode,
    options.searchPrivateType,
    effectiveMediaType,
    effectiveRetweets
  );

  return {
    enabled: true,
    request_kind: "timeline",
    scope: options.searchMode,
    summary_label:
      options.searchMode === "private"
        ? `Private ${options.searchPrivateType} @${singleUsername} · ${effectiveMediaType}`
        : `Public @${singleUsername} · ${timelineType} · ${effectiveMediaType}`,
    timeline_request: {
      username: singleUsername,
      auth_token: authToken,
      timeline_type: timelineType,
      batch_size: 0,
      page: 0,
      media_type: effectiveMediaType,
      retweets: effectiveRetweets,
    },
  };
}

function App() {
  const {
    workspaceTab,
    setWorkspaceTab,
    savedTabVisited,
    diagnosticsOpen,
    setDiagnosticsOpen,
    settingsOpen,
    setSettingsOpen,
  } = useWorkspaceChromeState();
  const [workspaceSettings, setWorkspaceSettings] = useState<Settings>(() => getSettings());
  const [username, setUsername] = useState("");
  const [fetchedMediaType, setFetchedMediaType] = useState<string>("all");
  const [savedTimelineSelection, setSavedTimelineSelection] = useState<{
    account: backend.AccountListItem;
    scope: FetchScope;
  } | null>(null);
  const [fetchType, setFetchType] = useState<FetchType>("single");
  const {
    searchMode,
    setSearchMode,
    searchPrivateType,
    setSearchPrivateType,
    handleModeChange,
    publicAuthToken,
    setPublicAuthToken,
    privateAuthToken,
    setPrivateAuthToken,
    rememberPublicToken,
    rememberPrivateToken,
    handleRememberPublicTokenChange,
    handleRememberPrivateTokenChange,
    useDateRange,
    setUseDateRange,
    startDate,
    setStartDate,
    endDate,
    setEndDate,
  } = useWorkspaceSettingsState();

  useEffect(() => {
    syncSettingsSnapshot(getSettings());
  }, []);

  useEffect(() => {
    const handleSettingsChanged = (event: Event) => {
      const nextSettings = (event as CustomEvent<Settings>).detail || getSettings();
      setWorkspaceSettings(nextSettings);
    };

    window.addEventListener(SETTINGS_CHANGED_EVENT, handleSettingsChanged as EventListener);
    return () => {
      window.removeEventListener(SETTINGS_CHANGED_EVENT, handleSettingsChanged as EventListener);
    };
  }, []);

  const {
    fetchHistory,
    addToHistory,
    removeFromHistory,
    clearFetchHistory,
  } = useFetchHistory();
  const {
    fetchTaskHistory,
    addFetchTaskHistory,
    removeFetchTaskHistory,
    clearFetchTaskHistory,
  } = useFetchTaskHistory();

  const {
    loading,
    result,
    resumeInfo,
    elapsedTime,
    remainingTime,
    newMediaCount,
    taskStatus: singleFetchTaskStatus,
    handleFetchSingle,
    handleResume,
    handleClearResume,
    handleStopFetch,
    clearLiveResult,
    clearResumeInfo,
  } = useSingleFetchController({
    username,
    setUsername,
    onAddToHistory: addToHistory,
    onRecordTask: addFetchTaskHistory,
  });

  const {
    activeSession,
    recentSessions,
    isFetchingAll,
    createPendingSession,
    resetMultipleQueueState,
    handleFetchAll,
    handleStopAll,
    removeCurrentSession,
    removeRecentSession,
    clearRecentSessions,
  } = useMultiFetchController();

  const {
    globalDownloadState,
    globalDownloadTaskState,
    globalDownloadMeta,
    globalDownloadHistory,
    removeDownloadHistory,
    clearDownloadHistory,
    handleDownloadSessionStart,
    handleDownloadSessionFinish,
    handleDownloadSessionFail,
    handleGlobalStopDownload,
  } = useGlobalDownloadMonitor();
  const {
    integrityTaskStatus,
    integrityReport,
    showIntegrityReport,
    handleCheckIntegrity,
    handleCancelIntegrityCheck,
    handleOpenIntegrityFolder,
    setShowIntegrityReport,
  } = useGlobalIntegrityMonitor();

  const handleMultiAccountDownload = useCallback(async () => {
    if (globalDownloadState?.in_progress) {
      toast.warning("A download is already in progress");
      return;
    }

    const accountsToDownload = activeSession?.accounts.filter((account) => account.mediaCount > 0) || [];

    if (accountsToDownload.length === 0) {
      toast.error("No fetched media is ready to download yet");
      return;
    }

    const scopes = accountsToDownload.map((account) => {
      const accountMode = account.mode ?? searchMode;
      const accountPrivateType = account.privateType ?? searchPrivateType;
      const accountMediaType = account.mediaType ?? fetchedMediaType ?? "all";
      const accountRetweets = account.retweets ?? false;
      const timelineType = resolveFetchTimelineType(
        false,
        accountMode,
        accountPrivateType,
        accountMediaType,
        accountRetweets
      );

      return {
        username: account.username,
        media_type: accountMediaType,
        timeline_type: timelineType,
        retweets: accountRetweets,
        query_key: "",
      };
    });

      const totalItems = accountsToDownload.reduce((sum, account) => sum + account.mediaCount, 0);

    handleDownloadSessionStart({
      source: "multi-account-workspace",
        title: `Downloading ${accountsToDownload.length} Accounts`,
        subtitle: `${formatNumberWithComma(totalItems)} item(s) from ${formatNumberWithComma(accountsToDownload.length)} fetched account(s)`,
        targetKey: "multi-account-workspace",
    });

    try {
      const settings = getSettings();
      const response = await DownloadSavedScopes(new main.DownloadSavedScopesRequest({
        scopes,
        output_dir: settings.downloadPath || "",
        proxy: settings.proxy || "",
      }));

      if (response.success) {
        const parts: string[] = [];
        if (response.downloaded > 0) {
          parts.push(`${response.downloaded} downloaded`);
        }
        if (response.skipped > 0) {
          parts.push(`${response.skipped} skipped`);
        }
        if (response.failed > 0) {
          parts.push(`${response.failed} failed`);
        }
        toast.success(parts.length > 0 ? parts.join(", ") : "Download completed");
        handleDownloadSessionFinish(response.failed > 0 ? "failed" : "completed");
      } else {
        handleDownloadSessionFail();
        toast.error(response.message || "Download failed");
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error(`Multi-account download failed: ${errorMsg}`);
      handleDownloadSessionFail();
      toast.error("Multi-account download failed");
    }
  }, [
    fetchedMediaType,
    globalDownloadState?.in_progress,
    handleDownloadSessionFail,
    handleDownloadSessionFinish,
    handleDownloadSessionStart,
    activeSession,
    searchMode,
    searchPrivateType,
  ]);

  const handleDownloadFetchedAccounts = useCallback(() => {
    void handleMultiAccountDownload();
  }, [handleMultiAccountDownload]);

  const activityPanelState = useActivityPanelState({
    fetchType,
    username,
    elapsedTime,
    remainingTime,
    singleFetchTaskStatus,
    activeSession,
    result,
    resumeInfo,
    globalDownloadTaskState,
    globalDownloadMeta,
    globalDownloadHistory,
    integrityTaskStatus,
    integrityReport,
  });

  const handleStopActiveFetch = useCallback(() => {
    if (fetchType === "multiple") {
      handleStopAll();
      return;
    }

    void handleStopFetch();
  }, [fetchType, handleStopAll, handleStopFetch]);

  const {
    handleFetch,
    handleLoadFromDB,
    handleUpdateSelected,
    handleImportFile,
    handleHistorySelect,
  } = useFetchWorkspaceCoordinator({
    username,
    setUsername,
    loading,
    publicAuthToken,
    setFetchedMediaType,
    setFetchType,
    setWorkspaceTab,
    setSavedTimelineSelection,
    setSearchMode,
    setSearchPrivateType,
    createPendingSession,
    clearLiveResult,
    clearResumeInfo,
    resetMultipleQueueState,
    handleFetchSingle,
    handleFetchAll,
  });

  const activityPanel = (
    <ActivityPanel
      fetch={activityPanelState.fetch}
      download={activityPanelState.download}
      integrity={activityPanelState.integrity}
      failures={activityPanelState.failures}
      onStopFetch={handleStopActiveFetch}
      onStopDownload={handleGlobalStopDownload}
      onStopIntegrity={handleCancelIntegrityCheck}
    />
  );

  const fetchView = (
    <FetchWorkspaceLayout
      sidebar={
        <FetchWorkspaceSidebar
          username={username}
          loading={loading}
          onUsernameChange={setUsername}
          onFetch={handleFetch}
          onStopFetch={handleStopFetch}
          onResume={handleResume}
          onClearResume={handleClearResume}
          resumeInfo={resumeInfo}
          onImportFile={handleImportFile}
          onStopAll={handleStopAll}
          isFetchingAll={isFetchingAll}
          mode={searchMode}
          privateType={searchPrivateType}
          useDateRange={useDateRange}
          startDate={startDate}
          endDate={endDate}
          publicAuthToken={publicAuthToken}
          privateAuthToken={privateAuthToken}
          onModeChange={handleModeChange}
        />
      }
      workspace={
        result && fetchType === "single" ? (
          <Suspense fallback={<WorkspaceLoadingState label="media results" />}>
            <MediaWorkspace
              accountInfo={result.account_info}
              timeline={result.timeline}
              totalUrls={result.total_urls}
              fetchedMediaType={fetchedMediaType}
              newMediaCount={newMediaCount}
              downloadState={globalDownloadState}
              downloadMeta={globalDownloadMeta}
              onDownloadSessionStart={handleDownloadSessionStart}
              onDownloadSessionFinish={handleDownloadSessionFinish}
              onDownloadSessionFail={handleDownloadSessionFail}
            />
          </Suspense>
        ) : savedTimelineSelection && fetchType === "single" ? (
          <Suspense fallback={<WorkspaceLoadingState label="saved media results" />}>
            <SavedTimelineWorkspace
              account={savedTimelineSelection.account}
              scope={savedTimelineSelection.scope}
              downloadState={globalDownloadState}
              downloadMeta={globalDownloadMeta}
              onDownloadSessionStart={handleDownloadSessionStart}
              onDownloadSessionFinish={handleDownloadSessionFinish}
              onDownloadSessionFail={handleDownloadSessionFail}
            />
          </Suspense>
        ) : fetchType === "multiple" && (activeSession || recentSessions.length > 0) ? (
          <MultiAccountWorkspace
            session={activeSession}
            recentSessions={recentSessions}
            isFetchingAll={isFetchingAll}
            isDownloading={Boolean(globalDownloadState?.in_progress)}
            onDownloadFetched={handleDownloadFetchedAccounts}
            onRemoveCurrentSession={removeCurrentSession}
            onRemoveRecentSession={removeRecentSession}
            onClearRecentSessions={clearRecentSessions}
          />
        ) : (
          <div className="flex h-full min-h-[420px] items-center justify-center rounded-[24px] border border-dashed border-border/80 bg-muted/20 px-8 text-center">
            <div className="max-w-md space-y-3">
              <h2 className="text-2xl font-semibold tracking-tight">
                Fetch Workspace
              </h2>
              <p className="text-sm leading-6 text-muted-foreground">
                Start a fetch from the left control panel. Current results, previews,
                and download actions will stay here while the right activity rail keeps
                fetch and download status visible.
              </p>
            </div>
          </div>
        )
      }
      activityPanel={activityPanel}
    />
  );

  const savedView = (
    <SavedWorkspaceLayout
      library={
        <Suspense fallback={<WorkspaceLoadingState label="saved accounts" />}>
          <DatabaseWorkspace
            onLoadAccount={handleLoadFromDB}
            onUpdateSelected={handleUpdateSelected}
            downloadState={globalDownloadState}
            downloadMeta={globalDownloadMeta}
            onStopDownload={handleGlobalStopDownload}
            onDownloadSessionStart={handleDownloadSessionStart}
            onDownloadSessionFinish={handleDownloadSessionFinish}
            onDownloadSessionFail={handleDownloadSessionFail}
            recentFetches={fetchHistory}
            onSelectRecentFetch={handleHistorySelect}
            onRemoveRecentFetch={removeFromHistory}
            onClearRecentFetches={clearFetchHistory}
          />
        </Suspense>
      }
      activityPanel={activityPanel}
    />
  );

  const diagnosticsParityContext = buildDiagnosticsParityContext({
    username,
    fetchType,
    searchMode,
    searchPrivateType,
    publicAuthToken,
    privateAuthToken,
    useDateRange,
    startDate,
    endDate,
    settings: workspaceSettings,
  });

  const historyView = (
    <section className="min-h-0 flex-1 overflow-hidden rounded-[28px] border border-border/70 bg-card/40 p-5 shadow-sm">
      <TaskHistoryWorkspace
        fetchHistory={fetchTaskHistory}
        queueHistory={recentSessions}
        downloadHistory={globalDownloadHistory}
        onRemoveFetchHistory={removeFetchTaskHistory}
        onClearFetchHistory={clearFetchTaskHistory}
        onRemoveQueueHistory={removeRecentSession}
        onClearQueueHistory={clearRecentSessions}
        onRemoveDownloadHistory={removeDownloadHistory}
        onClearDownloadHistory={clearDownloadHistory}
        onClearAllHistory={() => {
          clearFetchTaskHistory();
          clearRecentSessions();
          clearDownloadHistory();
        }}
      />
    </section>
  );

  return (
    <WorkspaceChrome
      version={APP_VERSION}
      workspaceTab={workspaceTab}
      onWorkspaceTabChange={setWorkspaceTab}
      onOpenDiagnostics={() => setDiagnosticsOpen(true)}
      onOpenSettings={() => setSettingsOpen(true)}
      drawers={
        <WorkspaceDrawers
          diagnosticsOpen={diagnosticsOpen}
          onDiagnosticsOpenChange={setDiagnosticsOpen}
          diagnosticsContent={
            <Suspense fallback={<WorkspaceLoadingState label="diagnostics" />}>
              <DiagnosticsPanel
                embedded
                fillHeight
                parityContext={diagnosticsParityContext}
                runbookTokens={{
                  public_auth_token: publicAuthToken.trim(),
                  private_auth_token: privateAuthToken.trim(),
                }}
              />
            </Suspense>
          }
          settingsOpen={settingsOpen}
          onSettingsOpenChange={setSettingsOpen}
          settingsContent={
            <Suspense fallback={<WorkspaceLoadingState label="settings" />}>
              <SettingsPanel
                embedded
                mode={searchMode}
                privateType={searchPrivateType}
                publicAuthToken={publicAuthToken}
                privateAuthToken={privateAuthToken}
                onPublicAuthTokenChange={setPublicAuthToken}
                onPrivateAuthTokenChange={setPrivateAuthToken}
                rememberPublicToken={rememberPublicToken}
                rememberPrivateToken={rememberPrivateToken}
                onRememberPublicTokenChange={handleRememberPublicTokenChange}
                onRememberPrivateTokenChange={handleRememberPrivateTokenChange}
                useDateRange={useDateRange}
                startDate={startDate}
                endDate={endDate}
                onUseDateRangeChange={setUseDateRange}
                onStartDateChange={setStartDate}
                onEndDateChange={setEndDate}
                integrityTaskStatus={integrityTaskStatus}
                integrityReport={integrityReport}
                showIntegrityReport={showIntegrityReport}
                onCheckIntegrityTask={handleCheckIntegrity}
                onCancelIntegrityTask={handleCancelIntegrityCheck}
                onShowIntegrityReportChange={setShowIntegrityReport}
                onOpenIntegrityFolder={handleOpenIntegrityFolder}
              />
            </Suspense>
          }
        />
      }
    >
      <DesktopSmokeDriver />
      <WorkspaceRouter
        workspaceTab={workspaceTab}
        savedTabVisited={savedTabVisited}
        fetchView={fetchView}
        savedView={savedView}
        historyView={historyView}
      />
    </WorkspaceChrome>
  );
}

export default App;
