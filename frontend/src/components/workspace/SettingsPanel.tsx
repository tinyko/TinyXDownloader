import { RotateCcw, Save } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { SettingsAppearanceSection } from "@/components/workspace/settings/SettingsAppearanceSection";
import { SettingsDownloadToolsSection } from "@/components/workspace/settings/SettingsDownloadToolsSection";
import { SettingsFetchControlsSection } from "@/components/workspace/settings/SettingsFetchControlsSection";
import { SettingsIntegritySection } from "@/components/workspace/settings/SettingsIntegritySection";
import { IntegrityReportDialog } from "@/components/workspace/settings/IntegrityReportDialog";
import { useSettingsPanelState } from "@/hooks/workspace/useSettingsPanelState";
import type { SettingsPanelProps } from "@/types/settings";

export function SettingsPanel(props: SettingsPanelProps) {
  const {
    embedded = false,
    mode = "public",
    privateType = "bookmarks",
    publicAuthToken,
    privateAuthToken,
    onPublicAuthTokenChange,
    onPrivateAuthTokenChange,
    rememberPublicToken,
    rememberPrivateToken,
    onRememberPublicTokenChange,
    onRememberPrivateTokenChange,
    useDateRange,
    startDate,
    endDate,
    onUseDateRangeChange,
    onStartDateChange,
    onEndDateChange,
  } = props;

  const state = useSettingsPanelState({ embedded, mode, privateType });

  return (
    <div className="space-y-6">
      {!embedded ? <h1 className="text-2xl font-bold">Settings</h1> : null}

      {state.showFetchControls ? (
        <SettingsFetchControlsSection
          publicAuthToken={publicAuthToken}
          privateAuthToken={privateAuthToken}
          onPublicAuthTokenChange={onPublicAuthTokenChange}
          onPrivateAuthTokenChange={onPrivateAuthTokenChange}
          rememberPublicToken={rememberPublicToken}
          rememberPrivateToken={rememberPrivateToken}
          onRememberPublicTokenChange={onRememberPublicTokenChange}
          onRememberPrivateTokenChange={onRememberPrivateTokenChange}
          useDateRange={useDateRange}
          startDate={startDate}
          endDate={endDate}
          onUseDateRangeChange={onUseDateRangeChange}
          onStartDateChange={onStartDateChange}
          onEndDateChange={onEndDateChange}
          tempSettings={state.tempSettings}
          setTempSettings={state.setTempSettings}
          currentContextLabel={state.currentContextLabel}
          dateRangeAvailable={state.dateRangeAvailable}
          showPublicToken={state.showPublicToken}
          showPrivateToken={state.showPrivateToken}
          onTogglePublicToken={() => state.setShowPublicToken((current) => !current)}
          onTogglePrivateToken={() => state.setShowPrivateToken((current) => !current)}
        />
      ) : null}

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <SettingsAppearanceSection
          tempSettings={state.tempSettings}
          setTempSettings={state.setTempSettings}
          isDark={state.isDark}
          onBrowseFolder={state.handleBrowseFolder}
        />

        <div className="space-y-4">
          <SettingsDownloadToolsSection
            tempSettings={state.tempSettings}
            setTempSettings={state.setTempSettings}
            ffmpegInstalled={state.ffmpegInstalled}
            downloadingFFmpeg={state.downloadingFFmpeg}
            exiftoolInstalled={state.exiftoolInstalled}
            downloadingExifTool={state.downloadingExifTool}
            onDownloadFFmpeg={state.handleDownloadFFmpeg}
            onDownloadExifTool={state.handleDownloadExifTool}
          />

          <SettingsIntegritySection
            checkingIntegrity={state.checkingIntegrity}
            checkingIntegrityMode={state.checkingIntegrityMode}
            integrityReport={state.integrityReport}
            onCheckIntegrity={state.handleCheckIntegrity}
          />
        </div>
      </div>

      <div className="flex justify-between gap-2 border-t pt-4">
        <Button
          variant="outline"
          onClick={() => state.setShowResetConfirm(true)}
          className="gap-1.5"
        >
          <RotateCcw className="h-4 w-4" />
          Reset to Default
        </Button>
        <Button onClick={state.handleSave} className="gap-1.5">
          <Save className="h-4 w-4" />
          Save Changes
        </Button>
      </div>

      <Dialog open={state.showResetConfirm} onOpenChange={state.setShowResetConfirm}>
        <DialogContent className="max-w-md [&>button]:hidden">
          <DialogHeader>
            <DialogTitle>Reset to Default?</DialogTitle>
            <DialogDescription>
              This will reset all settings to their default values. Your custom configurations
              will be lost.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => state.setShowResetConfirm(false)}>
              Cancel
            </Button>
            <Button onClick={state.handleReset}>Reset</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <IntegrityReportDialog
        report={state.integrityReport}
        fallbackDownloadPath={state.tempSettings.downloadPath}
        open={state.showIntegrityReport}
        onOpenChange={state.setShowIntegrityReport}
        onOpenFolder={state.handleOpenIntegrityFolder}
      />
    </div>
  );
}
