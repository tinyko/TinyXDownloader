import { useMemo } from "react";
import {
  Bookmark,
  CloudDownload,
  FileText,
  Globe,
  Heart,
  Lock,
  RotateCcw,
  StopCircle,
  Trash2,
  XCircle,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { getSettings } from "@/lib/settings";
import type { FetchMode, PrivateType } from "@/components/SearchBar";

interface FetchWorkspaceSidebarProps {
  username: string;
  loading: boolean;
  onUsernameChange: (username: string) => void;
  onFetch: (
    useDateRange: boolean,
    startDate?: string,
    endDate?: string,
    mediaType?: string,
    retweets?: boolean,
    mode?: FetchMode,
    privateType?: PrivateType,
    authToken?: string,
    isResume?: boolean
  ) => void;
  onStopFetch: () => void;
  onResume?: (authToken: string, mediaType?: string, retweets?: boolean) => void;
  onClearResume?: () => void;
  resumeInfo?: { canResume: boolean; mediaCount: number } | null;
  onImportFile?: () => void;
  onStopAll?: () => void;
  isFetchingAll?: boolean;
  mode?: FetchMode;
  privateType?: PrivateType;
  onModeChange?: (mode: FetchMode, privateType?: PrivateType) => void;
  useDateRange: boolean;
  startDate: string;
  endDate: string;
  publicAuthToken: string;
  privateAuthToken: string;
}

function formatNumberWithComma(num: number) {
  return num.toLocaleString();
}

function parseUsernameInput(value: string) {
  return value
    .split(/\r?\n/)
    .map((line) => {
      let clean = line.trim();
      if (clean.startsWith("@")) {
        clean = clean.slice(1);
      }
      if (clean.includes("x.com/") || clean.includes("twitter.com/")) {
        const match = clean.match(/(?:x\.com|twitter\.com)\/([^/?]+)/);
        if (match) {
          clean = match[1];
        }
      }
      return clean.trim();
    })
    .filter(Boolean);
}

function SectionCard({
  title,
  subtitle,
  children,
  action,
  className,
  bodyClassName,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section
      className={[
        "rounded-[24px] border border-border/70 bg-card/95 px-3 py-2.5 shadow-sm",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <div className="mb-2.5 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
            {title}
          </h2>
          {subtitle ? (
            <p className="mt-1 text-xs text-muted-foreground">{subtitle}</p>
          ) : null}
        </div>
        {action}
      </div>
      <div className={bodyClassName}>{children}</div>
    </section>
  );
}

export function FetchWorkspaceSidebar({
  username,
  loading,
  onUsernameChange,
  onFetch,
  onStopFetch,
  onResume,
  onClearResume,
  resumeInfo,
  onImportFile,
  onStopAll,
  isFetchingAll = false,
  mode: externalMode,
  privateType: externalPrivateType,
  onModeChange,
  useDateRange,
  startDate,
  endDate,
  publicAuthToken,
  privateAuthToken,
}: FetchWorkspaceSidebarProps) {
  const toggleButtonClass =
    "h-10 min-w-0 gap-1.5 rounded-xl border-0 px-2 text-xs leading-none sm:text-[13px]";

  const mode = externalMode || "public";
  const privateType = externalPrivateType || "bookmarks";
  const isLikesMode = mode === "private" && privateType === "likes";
  const isBookmarksMode = mode === "private" && privateType === "bookmarks";
  const parsedUsernames = useMemo(() => parseUsernameInput(username), [username]);
  const detectedAccountCount = parsedUsernames.length;
  const isQueueInput = mode === "public" && detectedAccountCount > 1;
  const currentAuthToken = mode === "public" ? publicAuthToken : privateAuthToken;
  const hasAuthToken = currentAuthToken.trim().length > 0;

  const handleFetch = () => {
    const currentSettings = getSettings();
    const effectiveUseDateRange = mode === "public" ? useDateRange : false;
    const authToken = mode === "public" ? publicAuthToken : privateAuthToken;
    onFetch(
      effectiveUseDateRange,
      startDate,
      endDate,
      currentSettings.mediaType,
      currentSettings.includeRetweets,
      mode,
      privateType,
      authToken,
      false
    );
  };

  const handleResume = () => {
    const currentSettings = getSettings();
    const authToken = mode === "public" ? publicAuthToken : privateAuthToken;
    onResume?.(authToken, currentSettings.mediaType, currentSettings.includeRetweets);
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-2.5 pb-2.5">
      <SectionCard title="Mode">
        <div className="space-y-2.5">
          <div className="grid grid-cols-2 gap-2 rounded-2xl border border-border/70 bg-muted/35 p-1">
            <Button
              variant={mode === "public" ? "secondary" : "outline"}
              className={`${toggleButtonClass} justify-center`}
              onClick={() => onModeChange?.("public")}
            >
              <Globe className="h-4 w-4" />
              <span className="truncate">Public</span>
            </Button>
            <Button
              variant={mode === "private" ? "secondary" : "outline"}
              className={`${toggleButtonClass} justify-center`}
              onClick={() => onModeChange?.("private")}
            >
              <Lock className="h-4 w-4" />
              <span className="truncate">Private</span>
            </Button>
          </div>

          {mode === "private" ? (
            <div className="grid grid-cols-2 gap-2 rounded-2xl border border-border/70 bg-muted/35 p-1">
              <Button
                variant={privateType === "bookmarks" ? "secondary" : "outline"}
                className={`${toggleButtonClass} justify-center`}
                onClick={() => onModeChange?.("private", "bookmarks")}
              >
                <Bookmark className="h-4 w-4" />
                <span className="truncate">Bookmarks</span>
              </Button>
              <Button
                variant={privateType === "likes" ? "secondary" : "outline"}
                className={`${toggleButtonClass} justify-center`}
                onClick={() => onModeChange?.("private", "likes")}
              >
                <Heart className="h-4 w-4" />
                <span className="truncate">Likes</span>
              </Button>
            </div>
          ) : null}
        </div>
      </SectionCard>

      <SectionCard
        title="Input"
        className="flex min-h-0 flex-1 flex-col"
        bodyClassName="flex min-h-0 flex-1 flex-col"
      >
        <div className="flex min-h-0 flex-1 flex-col gap-2.5">
          {!isBookmarksMode ? (
            <div className="flex min-h-0 flex-1 flex-col gap-2">
              <div className="flex items-center justify-between gap-3">
                <Label htmlFor="username-list">
                  {isLikesMode ? "Your Username" : "Username / Usernames"}
                </Label>
                {detectedAccountCount > 0 ? (
                  <span className="text-xs text-muted-foreground">
                    {formatNumberWithComma(detectedAccountCount)} detected
                  </span>
                ) : null}
              </div>
              <div className="relative min-h-0 flex-1">
                <textarea
                  id="username-list"
                  placeholder={
                    isLikesMode
                      ? "your_username or https://x.com/your_username"
                      : "Paste one or more usernames/URLs, one per line"
                  }
                  value={username}
                  onChange={(event) => onUsernameChange(event.target.value)}
                  className="dark:bg-input/30 border-input placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive h-full min-h-[280px] w-full resize-none rounded-xl border bg-transparent px-3 py-2.5 pr-10 text-sm shadow-xs outline-none transition-[color,box-shadow] focus-visible:ring-[3px]"
                  spellCheck={false}
                />
                {username ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className="absolute right-1 top-2"
                    onClick={() => onUsernameChange("")}
                    aria-label="Clear usernames"
                  >
                    <XCircle className="h-4 w-4" />
                  </Button>
                ) : null}
              </div>
              {isQueueInput ? (
                <p className="text-xs text-muted-foreground">
                  Multiple accounts detected. Clicking fetch will automatically run a queue with the current options.
                </p>
              ) : isLikesMode ? (
                <p className="text-xs text-muted-foreground">
                  Likes mode supports one username at a time.
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Paste one account per line. A single line opens the usual single-account result view.
                </p>
              )}
            </div>
          ) : (
            <p className="flex-1 text-sm text-muted-foreground">
              Bookmarks fetch your own authenticated account, so no username input is needed.
            </p>
          )}

          <div className="flex flex-wrap gap-2">
            {loading ? (
              <Button
                variant="destructive"
                className="h-10 flex-1 rounded-xl"
                onClick={onStopFetch}
              >
                <StopCircle className="h-4 w-4" />
                Stop Fetch
              </Button>
            ) : isFetchingAll ? (
              <Button
                variant="destructive"
                className="h-10 flex-1 rounded-xl"
                onClick={onStopAll}
              >
                <StopCircle className="h-4 w-4" />
                Stop Queue
              </Button>
            ) : (
              <Button
                className="h-10 flex-1 rounded-xl"
                onClick={handleFetch}
                disabled={!hasAuthToken || (!isBookmarksMode && detectedAccountCount === 0)}
              >
                {isBookmarksMode ? (
                  <Bookmark className="h-4 w-4" />
                ) : isLikesMode ? (
                  <Heart className="h-4 w-4" />
                ) : (
                  <CloudDownload className="h-4 w-4" />
                )}
                {isBookmarksMode
                  ? "Fetch Bookmarks"
                  : isQueueInput
                    ? `Fetch ${formatNumberWithComma(detectedAccountCount)} Accounts`
                    : isLikesMode
                      ? "Fetch Likes"
                      : "Start Fetch"}
              </Button>
            )}

            {!isBookmarksMode ? (
              <Button
                variant="outline"
                className="h-10 rounded-xl"
                onClick={onImportFile}
                disabled={loading || isFetchingAll}
              >
                <FileText className="h-4 w-4" />
                Import TXT
              </Button>
            ) : null}

            {!loading && !isFetchingAll && resumeInfo?.canResume && mode === "public" && detectedAccountCount <= 1 ? (
              <>
                <Button
                  variant="secondary"
                  className="h-10 rounded-xl"
                  onClick={handleResume}
                  disabled={!hasAuthToken}
                >
                  <RotateCcw className="h-4 w-4" />
                  Resume {resumeInfo.mediaCount.toLocaleString()}
                </Button>
                <Button
                  variant="outline"
                  className="h-10 rounded-xl"
                  onClick={onClearResume}
                >
                  <Trash2 className="h-4 w-4" />
                  Clear
                </Button>
              </>
            ) : null}
          </div>
        </div>
      </SectionCard>
    </div>
  );
}
