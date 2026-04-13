import type { UseDatabaseActionsOptions } from "@/hooks/database/databaseActionTypes";
import type { AccountListItem } from "@/types/database";
import { getSettings } from "@/lib/settings";
import { toastWithSound as toast } from "@/lib/toast-with-sound";
import { ExportAccountJSON, ExportAccountsTXT, SaveAccountToDB } from "../../../wailsjs/go/main/App";

function getImportMediaType(data: any) {
  if (data.media_type) {
    return data.media_type;
  }

  if (data.media_list && Array.isArray(data.media_list)) {
    const types = new Set(
      data.media_list
        .map((item: { media_type?: string; type?: string }) => item.media_type || item.type)
        .filter(Boolean)
    );

    if (types.size === 1) {
      const singleType = Array.from(types)[0] as string;
      if (singleType === "photo") return "image";
      if (singleType === "video") return "video";
      if (singleType === "animated_gif") return "gif";
      return singleType;
    }
  }

  if (data.timeline && Array.isArray(data.timeline)) {
    const types = new Set(
      data.timeline
        .map((item: { type?: string }) => item.type)
        .filter(Boolean)
    );

    if (types.size === 1) {
      const singleType = Array.from(types)[0] as string;
      if (singleType === "photo") return "image";
      if (singleType === "video") return "video";
      if (singleType === "animated_gif") return "gif";
      if (singleType === "text") return "text";
      return singleType;
    }
  }

  return "all";
}

interface UseDatabaseImportExportActionsArgs
  extends Pick<UseDatabaseActionsOptions, "accounts" | "selectedIds" | "loadAccounts"> {}

export function useDatabaseImportExportActions({
  accounts,
  selectedIds,
  loadAccounts,
}: UseDatabaseImportExportActionsArgs) {
  const handleExportJSON = async () => {
    const idsToExport =
      selectedIds.size > 0
        ? Array.from(selectedIds)
        : accounts.map((account) => account.id);

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
        exported += 1;
      }
      toast.success(
        `Exported ${exported} account(s) to ${outputDir}\\twitterxmediabatchdownloader_backups`
      );
    } catch {
      toast.error("Failed to export");
    }
  };

  const handleExportSingleAccount = async (account: AccountListItem) => {
    const settings = getSettings();
    const outputDir = settings.downloadPath || "";
    try {
      await ExportAccountJSON(account.id, outputDir);
      toast.success(`Exported @${account.username}`);
    } catch {
      toast.error("Failed to export");
    }
  };

  const handleExportTXT = async () => {
    const idsToExport =
      selectedIds.size > 0
        ? Array.from(selectedIds)
        : accounts.map((account) => account.id);

    if (idsToExport.length === 0) {
      toast.error("No accounts to export");
      return;
    }

    const settings = getSettings();
    const outputDir = settings.downloadPath || "";

    try {
      await ExportAccountsTXT(idsToExport, outputDir);
      toast.success(
        `Exported ${idsToExport.length.toLocaleString()} account(s) to ${outputDir}\\twitterxmediabatchdownloader_backups\\twitterxmediabatchdownloader_multiple.txt`
      );
    } catch {
      toast.error("Failed to export");
    }
  };

  const handleImport = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json";
    input.multiple = true;
    input.onchange = async (event) => {
      const files = (event.target as HTMLInputElement).files;
      if (!files || files.length === 0) return;

      let imported = 0;
      for (const file of Array.from(files)) {
        try {
          const text = await file.text();
          const data = JSON.parse(text);
          const detectedMediaType = getImportMediaType(data);

          if (data.account_info && data.timeline) {
            await SaveAccountToDB(
              data.account_info.name,
              data.account_info.nick,
              data.account_info.profile_image,
              data.total_urls || data.timeline.length,
              text,
              detectedMediaType
            );
            imported += 1;
          } else if (data.username && data.media_list) {
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
              timeline: data.media_list.map(
                (item: {
                  url: string;
                  date: string;
                  tweet_id: string;
                  type: string;
                  media_type?: string;
                }) => ({
                  url: item.url,
                  date: item.date,
                  tweet_id: item.tweet_id,
                  type: item.media_type || item.type,
                  is_retweet: false,
                })
              ),
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
            imported += 1;
          }
        } catch (error) {
          console.error(`Failed to import ${file.name}:`, error);
        }
      }

      if (imported > 0) {
        toast.success(`Imported ${imported} account(s)`);
        await loadAccounts();
      } else {
        toast.error("No valid files imported");
      }
    };
    input.click();
  };

  return {
    handleExportJSON,
    handleExportSingleAccount,
    handleExportTXT,
    handleImport,
  };
}
