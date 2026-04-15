import { GetDefaults } from "../../wailsjs/go/main/App";

export interface RuntimeDefaults {
  downloadPath: string;
  appDataDir: string;
  smokeMode: boolean;
  smokeReportPath: string;
}

export async function getRuntimeDefaults(): Promise<RuntimeDefaults> {
  const defaults = await GetDefaults();
  return {
    downloadPath: defaults.downloadPath || "",
    appDataDir: defaults.appDataDir || "",
    smokeMode: defaults.smokeMode === "1",
    smokeReportPath: defaults.smokeReportPath || "",
  };
}
