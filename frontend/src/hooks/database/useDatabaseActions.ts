import type { UseDatabaseActionsOptions } from "@/hooks/database/databaseActionTypes";
import { useDatabaseDownloadActions } from "@/hooks/database/useDatabaseDownloadActions";
import { useDatabaseImportExportActions } from "@/hooks/database/useDatabaseImportExportActions";
import { useDatabaseMutationActions } from "@/hooks/database/useDatabaseMutationActions";

export function useDatabaseActions(options: UseDatabaseActionsOptions) {
  const downloadActions = useDatabaseDownloadActions(options);
  const importExportActions = useDatabaseImportExportActions(options);
  const mutationActions = useDatabaseMutationActions(options);

  return {
    ...mutationActions,
    ...downloadActions,
    ...importExportActions,
  };
}
