import { useCallback, useEffect, useState } from "react";

import { getSettings, updateSettings, applyThemeMode, applyFont } from "@/lib/settings";
import { applyTheme } from "@/lib/themes";
import type { FetchMode, PrivateType } from "@/types/fetch";
import { GetStoredAuthTokens, SaveStoredAuthTokens } from "../../../wailsjs/go/main/App";

export function useWorkspaceSettingsState() {
  const initialSettings = getSettings();

  const [searchMode, setSearchMode] = useState<FetchMode>("public");
  const [searchPrivateType, setSearchPrivateType] = useState<PrivateType>("bookmarks");
  const [publicAuthToken, setPublicAuthToken] = useState("");
  const [privateAuthToken, setPrivateAuthToken] = useState("");
  const [rememberPublicToken, setRememberPublicToken] = useState(
    initialSettings.rememberPublicToken
  );
  const [rememberPrivateToken, setRememberPrivateToken] = useState(
    initialSettings.rememberPrivateToken
  );
  const [useDateRange, setUseDateRange] = useState(false);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [storedTokensReady, setStoredTokensReady] = useState(false);

  useEffect(() => {
    const settings = getSettings();
    applyThemeMode(settings.themeMode);
    applyTheme(settings.theme);
    applyFont(settings.fontFamily);

    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const handleChange = () => {
      const currentSettings = getSettings();
      if (currentSettings.themeMode === "auto") {
        applyThemeMode("auto");
        applyTheme(currentSettings.theme);
      }
    };

    mediaQuery.addEventListener("change", handleChange);

    return () => {
      mediaQuery.removeEventListener("change", handleChange);
    };
  }, []);

  useEffect(() => {
    let active = true;

    const loadStoredTokens = async () => {
      try {
        const tokens = await GetStoredAuthTokens();
        if (!active) {
          return;
        }

        if (rememberPublicToken && tokens.public_token) {
          setPublicAuthToken(tokens.public_token);
        }
        if (rememberPrivateToken && tokens.private_token) {
          setPrivateAuthToken(tokens.private_token);
        }
      } catch (error) {
        console.error("Failed to load stored auth tokens:", error);
      } finally {
        if (active) {
          setStoredTokensReady(true);
        }
      }
    };

    void loadStoredTokens();

    return () => {
      active = false;
    };
  }, [rememberPrivateToken, rememberPublicToken]);

  useEffect(() => {
    if (!storedTokensReady) {
      return;
    }

    SaveStoredAuthTokens({
      public_token: rememberPublicToken ? publicAuthToken.trim() : "",
      private_token: rememberPrivateToken ? privateAuthToken.trim() : "",
    }).catch((error: unknown) => {
      console.error("Failed to persist auth tokens:", error);
    });
  }, [
    storedTokensReady,
    publicAuthToken,
    privateAuthToken,
    rememberPublicToken,
    rememberPrivateToken,
  ]);

  const handleRememberPublicTokenChange = useCallback((value: boolean) => {
    updateSettings({ rememberPublicToken: value });
    setRememberPublicToken(value);
  }, []);

  const handleRememberPrivateTokenChange = useCallback((value: boolean) => {
    updateSettings({ rememberPrivateToken: value });
    setRememberPrivateToken(value);
  }, []);

  const handleModeChange = useCallback((mode: FetchMode, privateType?: PrivateType) => {
    setSearchMode(mode);
    if (privateType) {
      setSearchPrivateType(privateType);
    }
  }, []);

  return {
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
  };
}
