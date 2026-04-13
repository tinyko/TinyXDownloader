import type { Dispatch, SetStateAction } from "react";

import { Button } from "@/components/ui/button";
import { InputWithContext } from "@/components/ui/input-with-context";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { FolderOpen } from "lucide-react";
import { FONT_OPTIONS, type FontFamily, type Settings as SettingsType } from "@/lib/settings";
import { themes } from "@/lib/themes";

interface SettingsAppearanceSectionProps {
  tempSettings: SettingsType;
  setTempSettings: Dispatch<SetStateAction<SettingsType>>;
  isDark: boolean;
  onBrowseFolder: () => void | Promise<void>;
}

export function SettingsAppearanceSection({
  tempSettings,
  setTempSettings,
  isDark,
  onBrowseFolder,
}: SettingsAppearanceSectionProps) {
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="download-path">Download Path</Label>
        <div className="flex gap-2">
          <InputWithContext
            id="download-path"
            value={tempSettings.downloadPath}
            onChange={(event) =>
              setTempSettings((current) => ({
                ...current,
                downloadPath: event.target.value,
              }))
            }
            placeholder="C:\\Users\\YourUsername\\Pictures"
          />
          <Button type="button" onClick={onBrowseFolder} className="gap-1.5">
            <FolderOpen className="h-4 w-4" />
            Browse
          </Button>
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="theme-mode">Mode</Label>
        <Select
          value={tempSettings.themeMode}
          onValueChange={(value: "auto" | "light" | "dark") =>
            setTempSettings((current) => ({ ...current, themeMode: value }))
          }
        >
          <SelectTrigger id="theme-mode">
            <SelectValue placeholder="Select theme mode" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="auto">Auto</SelectItem>
            <SelectItem value="light">Light</SelectItem>
            <SelectItem value="dark">Dark</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label htmlFor="theme">Accent</Label>
        <Select
          value={tempSettings.theme}
          onValueChange={(value) =>
            setTempSettings((current) => ({ ...current, theme: value }))
          }
        >
          <SelectTrigger id="theme">
            <SelectValue placeholder="Select a theme" />
          </SelectTrigger>
          <SelectContent>
            {themes.map((theme) => (
              <SelectItem key={theme.name} value={theme.name}>
                <span className="flex items-center gap-2">
                  <span
                    className="h-3 w-3 rounded-full border border-border"
                    style={{
                      backgroundColor: isDark
                        ? theme.cssVars.dark.primary
                        : theme.cssVars.light.primary,
                    }}
                  />
                  {theme.label}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label htmlFor="font">Font</Label>
        <Select
          value={tempSettings.fontFamily}
          onValueChange={(value: FontFamily) =>
            setTempSettings((current) => ({ ...current, fontFamily: value }))
          }
        >
          <SelectTrigger id="font">
            <SelectValue placeholder="Select a font" />
          </SelectTrigger>
          <SelectContent>
            {FONT_OPTIONS.map((font) => (
              <SelectItem key={font.value} value={font.value}>
                <span style={{ fontFamily: font.fontFamily }}>{font.label}</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex items-center gap-3 pt-2">
        <Label htmlFor="sfx-enabled" className="cursor-pointer text-sm">
          Sound Effects
        </Label>
        <Switch
          id="sfx-enabled"
          checked={tempSettings.sfxEnabled}
          onCheckedChange={(checked) =>
            setTempSettings((current) => ({ ...current, sfxEnabled: checked }))
          }
        />
      </div>
    </div>
  );
}
