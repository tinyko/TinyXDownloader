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
import { Spinner } from "@/components/ui/spinner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Check, Download, Info } from "lucide-react";
import { type GifQuality, type GifResolution, type Settings as SettingsType } from "@/lib/settings";

interface SettingsDownloadToolsSectionProps {
  tempSettings: SettingsType;
  setTempSettings: Dispatch<SetStateAction<SettingsType>>;
  ffmpegInstalled: boolean;
  downloadingFFmpeg: boolean;
  exiftoolInstalled: boolean;
  downloadingExifTool: boolean;
  onDownloadFFmpeg: () => void | Promise<void>;
  onDownloadExifTool: () => void | Promise<void>;
}

export function SettingsDownloadToolsSection({
  tempSettings,
  setTempSettings,
  ffmpegInstalled,
  downloadingFFmpeg,
  exiftoolInstalled,
  downloadingExifTool,
  onDownloadFFmpeg,
  onDownloadExifTool,
}: SettingsDownloadToolsSectionProps) {
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label className="flex items-center gap-2">
          Metadata Embedding
          <Tooltip>
            <TooltipTrigger asChild>
              <Info className="h-3.5 w-3.5 cursor-help text-muted-foreground" />
            </TooltipTrigger>
            <TooltipContent side="top">
              <p>
                ExifTool is required to embed tweet URL and original filename into media file metadata
              </p>
            </TooltipContent>
          </Tooltip>
        </Label>
        <div className="flex h-9 items-center">
          {exiftoolInstalled ? (
            <div className="flex items-center gap-2 text-sm text-green-600 dark:text-green-400">
              <Check className="h-4 w-4" />
              Installed
            </div>
          ) : (
            <Button
              variant="outline"
              size="sm"
              className="h-9"
              onClick={onDownloadExifTool}
              disabled={downloadingExifTool}
            >
              {downloadingExifTool ? (
                <>
                  <Spinner />
                  Downloading...
                </>
              ) : (
                <>
                  <Download className="h-4 w-4" />
                  Download ExifTool
                </>
              )}
            </Button>
          )}
        </div>
      </div>

      <div className="space-y-2">
        <Label className="flex items-center gap-2">
          GIF Conversion
          <Tooltip>
            <TooltipTrigger asChild>
              <Info className="h-3.5 w-3.5 cursor-help text-muted-foreground" />
            </TooltipTrigger>
            <TooltipContent side="top">
              <p>FFmpeg is required to convert Twitter&apos;s MP4 to actual GIF format</p>
            </TooltipContent>
          </Tooltip>
        </Label>
        <div className="flex h-9 items-center">
          {ffmpegInstalled ? (
            <div className="flex items-center gap-2 text-sm text-green-600 dark:text-green-400">
              <Check className="h-4 w-4" />
              Installed
            </div>
          ) : (
            <Button
              variant="outline"
              size="sm"
              className="h-9"
              onClick={onDownloadFFmpeg}
              disabled={downloadingFFmpeg}
            >
              {downloadingFFmpeg ? (
                <>
                  <Spinner />
                  Downloading...
                </>
              ) : (
                <>
                  <Download className="h-4 w-4" />
                  Download FFmpeg
                </>
              )}
            </Button>
          )}
        </div>
      </div>

      {ffmpegInstalled ? (
        <div className="space-y-2">
          <Label htmlFor="gif-quality">GIF Quality</Label>
          <div className="flex items-center gap-2">
            <Select
              value={tempSettings.gifQuality}
              onValueChange={(value: GifQuality) =>
                setTempSettings((current) => ({ ...current, gifQuality: value }))
              }
            >
              <SelectTrigger id="gif-quality" className="w-auto">
                <SelectValue placeholder="Select quality" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="fast">Fast</SelectItem>
                <SelectItem value="better">Better</SelectItem>
              </SelectContent>
            </Select>
            <Select
              value={tempSettings.gifResolution}
              onValueChange={(value: GifResolution) =>
                setTempSettings((current) => ({ ...current, gifResolution: value }))
              }
            >
              <SelectTrigger id="gif-resolution" className="w-auto">
                <SelectValue placeholder="Resolution" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="original">Original</SelectItem>
                <SelectItem value="high">High (800px)</SelectItem>
                <SelectItem value="medium">Medium (600px)</SelectItem>
                <SelectItem value="low">Low (400px)</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      ) : null}

      <div className="space-y-2">
        <Label htmlFor="proxy" className="flex items-center gap-2">
          Proxy
          <Tooltip>
            <TooltipTrigger asChild>
              <Info className="h-3.5 w-3.5 cursor-help text-muted-foreground" />
            </TooltipTrigger>
            <TooltipContent side="top">
              <p>If download fails, try using a proxy server</p>
            </TooltipContent>
          </Tooltip>
        </Label>
        <InputWithContext
          id="proxy"
          value={tempSettings.proxy || ""}
          onChange={(event) =>
            setTempSettings((current) => ({ ...current, proxy: event.target.value }))
          }
          placeholder="http://proxy:port or socks5://proxy:port (optional)"
          className="w-[90%]"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="fetch-timeout" className="flex items-center gap-2">
          Fetch Timeout
          <Tooltip>
            <TooltipTrigger asChild>
              <Info className="h-3.5 w-3.5 cursor-help text-muted-foreground" />
            </TooltipTrigger>
            <TooltipContent side="top">
              <p>Timeout in seconds. Fetch stops automatically when reached</p>
            </TooltipContent>
          </Tooltip>
        </Label>
        <InputWithContext
          id="fetch-timeout"
          type="number"
          value={tempSettings.fetchTimeout || 60}
          onChange={(event) => {
            const inputValue = event.target.value;
            if (inputValue === "") {
              setTempSettings((current) => ({ ...current, fetchTimeout: 60 }));
              return;
            }

            const value = Number.parseInt(inputValue, 10);
            if (!Number.isNaN(value)) {
              setTempSettings((current) => ({ ...current, fetchTimeout: value }));
            }
          }}
          onBlur={(event) => {
            const value = Number.parseInt(event.target.value, 10);
            if (Number.isNaN(value) || value < 30) {
              setTempSettings((current) => ({ ...current, fetchTimeout: 30 }));
            } else if (value > 900) {
              setTempSettings((current) => ({ ...current, fetchTimeout: 900 }));
            }
          }}
          placeholder="60"
          className="w-[20%]"
        />
      </div>
    </div>
  );
}
