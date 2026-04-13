import { useEffect, useState } from "react";

import { getSettings } from "@/lib/settings";
import { CheckFolderExists } from "../../../wailsjs/go/main/App";

export function useSavedAccountFolderExists(accountFolderName: string, refreshKey?: string) {
  const [folderExists, setFolderExists] = useState(false);

  useEffect(() => {
    let active = true;

    const checkFolder = async () => {
      const settings = getSettings();
      if (!settings.downloadPath || !accountFolderName) {
        if (active) {
          setFolderExists(false);
        }
        return;
      }

      const exists = await CheckFolderExists(settings.downloadPath, accountFolderName);
      if (active) {
        setFolderExists(exists);
      }
    };

    void checkFolder();
    return () => {
      active = false;
    };
  }, [accountFolderName, refreshKey]);

  return folderExists;
}
