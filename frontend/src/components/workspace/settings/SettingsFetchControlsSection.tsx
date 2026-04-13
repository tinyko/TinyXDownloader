import { Eye, EyeOff, Globe, KeyRound, Lock } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { InputWithContext } from "@/components/ui/input-with-context";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Settings } from "@/lib/settings";
import type { SettingsPanelProps } from "@/types/settings";

interface SettingsFetchControlsSectionProps
  extends Pick<
    SettingsPanelProps,
    | "publicAuthToken"
    | "privateAuthToken"
    | "onPublicAuthTokenChange"
    | "onPrivateAuthTokenChange"
    | "rememberPublicToken"
    | "rememberPrivateToken"
    | "onRememberPublicTokenChange"
    | "onRememberPrivateTokenChange"
    | "useDateRange"
    | "startDate"
    | "endDate"
    | "onUseDateRangeChange"
    | "onStartDateChange"
    | "onEndDateChange"
  > {
  tempSettings: Settings;
  setTempSettings: React.Dispatch<React.SetStateAction<Settings>>;
  currentContextLabel: string;
  dateRangeAvailable: boolean;
  showPublicToken: boolean;
  showPrivateToken: boolean;
  onTogglePublicToken: () => void;
  onTogglePrivateToken: () => void;
}

export function SettingsFetchControlsSection({
  publicAuthToken = "",
  privateAuthToken = "",
  onPublicAuthTokenChange,
  onPrivateAuthTokenChange,
  rememberPublicToken = false,
  rememberPrivateToken = false,
  onRememberPublicTokenChange,
  onRememberPrivateTokenChange,
  useDateRange = false,
  startDate = "",
  endDate = "",
  onUseDateRangeChange,
  onStartDateChange,
  onEndDateChange,
  tempSettings,
  setTempSettings,
  currentContextLabel,
  dateRangeAvailable,
  showPublicToken,
  showPrivateToken,
  onTogglePublicToken,
  onTogglePrivateToken,
}: SettingsFetchControlsSectionProps) {
  return (
    <section className="rounded-[24px] border border-border/70 bg-card/70 p-5 shadow-sm">
      <div className="mb-4 flex flex-col gap-1">
        <h2 className="text-sm font-semibold tracking-tight">Fetch Controls</h2>
        <p className="text-xs text-muted-foreground">
          Auth tokens and fetch defaults for the current workspace. Current context:{" "}
          {currentContextLabel}.
        </p>
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="settings-public-auth" className="flex items-center gap-2">
              <Globe className="h-4 w-4 text-muted-foreground" />
              Public Auth Token
            </Label>
            <div className="relative">
              <InputWithContext
                id="settings-public-auth"
                type={showPublicToken ? "text" : "password"}
                placeholder="Enter public auth_token cookie value"
                value={publicAuthToken}
                onChange={(event) => onPublicAuthTokenChange?.(event.target.value)}
                className="h-11 pr-10"
                spellCheck={false}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="absolute right-1 top-1/2 -translate-y-1/2"
                onClick={onTogglePublicToken}
                aria-label={showPublicToken ? "Hide public auth token" : "Show public auth token"}
              >
                {showPublicToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </Button>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox
                id="remember-public-token"
                checked={rememberPublicToken}
                onCheckedChange={(checked) =>
                  onRememberPublicTokenChange?.(Boolean(checked))
                }
              />
              <Label htmlFor="remember-public-token" className="cursor-pointer">
                Remember public token on this device
              </Label>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="settings-private-auth" className="flex items-center gap-2">
              <Lock className="h-4 w-4 text-muted-foreground" />
              Private Auth Token
            </Label>
            <div className="relative">
              <InputWithContext
                id="settings-private-auth"
                type={showPrivateToken ? "text" : "password"}
                placeholder="Enter private auth_token cookie value"
                value={privateAuthToken}
                onChange={(event) => onPrivateAuthTokenChange?.(event.target.value)}
                className="h-11 pr-10"
                spellCheck={false}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="absolute right-1 top-1/2 -translate-y-1/2"
                onClick={onTogglePrivateToken}
                aria-label={showPrivateToken ? "Hide private auth token" : "Show private auth token"}
              >
                {showPrivateToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </Button>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox
                id="remember-private-token"
                checked={rememberPrivateToken}
                onCheckedChange={(checked) =>
                  onRememberPrivateTokenChange?.(Boolean(checked))
                }
              />
              <Label htmlFor="remember-private-token" className="cursor-pointer">
                Remember private token on this device
              </Label>
            </div>
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              <KeyRound className="h-3.5 w-3.5" />
              Public fetch uses the public token. Bookmarks and likes use the private token.
            </p>
          </div>
        </div>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="fetch-mode">Fetch Mode</Label>
            <Select
              value={tempSettings.fetchMode}
              onValueChange={(value: "single" | "batch") =>
                setTempSettings((current) => ({ ...current, fetchMode: value }))
              }
            >
              <SelectTrigger id="fetch-mode" className="h-11 rounded-xl">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="batch">Batch</SelectItem>
                <SelectItem value="single">Single</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="fetch-media-type">Media Type</Label>
            <Select
              value={tempSettings.mediaType}
              onValueChange={(value: Settings["mediaType"]) =>
                setTempSettings((current) => ({ ...current, mediaType: value }))
              }
            >
              <SelectTrigger id="fetch-media-type" className="h-11 rounded-xl">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Media</SelectItem>
                <SelectItem value="image">Images</SelectItem>
                <SelectItem value="video">Videos</SelectItem>
                <SelectItem value="gif">GIFs</SelectItem>
                <SelectItem value="text">Text (No Media)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center gap-2 rounded-xl bg-muted/50 p-3">
            <Checkbox
              id="settings-retweets"
              checked={tempSettings.includeRetweets}
              onCheckedChange={(checked) =>
                setTempSettings((current) => ({
                  ...current,
                  includeRetweets: Boolean(checked),
                }))
              }
            />
            <Label htmlFor="settings-retweets" className="cursor-pointer">
              Include Retweets
            </Label>
          </div>

          <div className="space-y-3 rounded-2xl border border-border/70 bg-muted/20 p-3">
            <div className="flex items-center gap-2">
              <Checkbox
                id="settings-date-range"
                checked={dateRangeAvailable ? useDateRange : false}
                disabled={!dateRangeAvailable}
                onCheckedChange={(checked) => onUseDateRangeChange?.(Boolean(checked))}
              />
              <Label htmlFor="settings-date-range" className="cursor-pointer">
                Limit by date range
              </Label>
            </div>

            {dateRangeAvailable ? (
              useDateRange ? (
                <div className="grid gap-2 sm:grid-cols-2">
                  <InputWithContext
                    id="settings-start-date"
                    type="date"
                    value={startDate}
                    onChange={(event) => onStartDateChange?.(event.target.value)}
                    className="h-11 rounded-xl"
                  />
                  <InputWithContext
                    id="settings-end-date"
                    type="date"
                    value={endDate}
                    onChange={(event) => onEndDateChange?.(event.target.value)}
                    className="h-11 rounded-xl"
                  />
                </div>
              ) : null
            ) : (
              <p className="text-xs text-muted-foreground">
                Date range is only available for public fetches.
              </p>
            )}
          </div>

          <p className="text-xs text-muted-foreground">
            Fetch defaults follow the normal settings flow. Click{" "}
            <span className="font-medium text-foreground">Save Changes</span> to apply them.
          </p>
        </div>
      </div>
    </section>
  );
}
