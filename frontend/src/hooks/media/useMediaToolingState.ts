import { useCallback, useEffect, useState } from "react";

import { logger } from "@/lib/logger";
import { toastWithSound as toast } from "@/lib/toast-with-sound";
import {
  convertMediaGifs,
  readMediaToolingSnapshot,
} from "@/lib/media/client";

interface UseMediaToolingStateArgs {
  accountFolderName: string;
  refreshKey: string | number;
}

export function useMediaToolingState({
  accountFolderName,
  refreshKey,
}: UseMediaToolingStateArgs) {
  const [ffmpegInstalled, setFfmpegInstalled] = useState(false);
  const [folderExists, setFolderExists] = useState(false);
  const [gifsFolderHasMP4, setGifsFolderHasMP4] = useState(false);
  const [isConverting, setIsConverting] = useState(false);

  const refreshToolingState = useCallback(async () => {
    const snapshot = await readMediaToolingSnapshot(accountFolderName);
    setFfmpegInstalled(snapshot.ffmpegInstalled);
    setFolderExists(snapshot.folderExists);
    setGifsFolderHasMP4(snapshot.gifsFolderHasMP4);
    return snapshot;
  }, [accountFolderName]);

  useEffect(() => {
    let active = true;

    const load = async () => {
      const snapshot = await readMediaToolingSnapshot(accountFolderName);
      if (!active) {
        return;
      }
      setFfmpegInstalled(snapshot.ffmpegInstalled);
      setFolderExists(snapshot.folderExists);
      setGifsFolderHasMP4(snapshot.gifsFolderHasMP4);
    };

    void load();
    return () => {
      active = false;
    };
  }, [accountFolderName, refreshKey]);

  const handleConvertGifs = useCallback(async () => {
    setIsConverting(true);
    logger.info("Converting GIFs...");

    try {
      const response = await convertMediaGifs(accountFolderName);
      if (!response.success) {
        logger.error(response.message);
        toast.error("Convert failed");
        return;
      }

      logger.success(`Converted ${response.converted} GIFs`);
      toast.success(`${response.converted} GIFs converted`);
      await refreshToolingState();
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error(`Convert failed: ${errorMsg}`);
      toast.error("Convert failed");
    } finally {
      setIsConverting(false);
    }
  }, [accountFolderName, refreshToolingState]);

  return {
    ffmpegInstalled,
    folderExists,
    gifsFolderHasMP4,
    isConverting,
    refreshToolingState,
    handleConvertGifs,
  };
}
