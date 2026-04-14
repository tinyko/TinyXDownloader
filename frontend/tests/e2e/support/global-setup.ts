import fs from "node:fs";
import { spawnSync } from "node:child_process";

import {
  E2E_GENERATED_DIR,
  EXPORT_SCRIPT_PATH,
  SEEDED_DB_PATH,
  SEEDED_JSON_PATH,
} from "./constants";

function resolvePythonCommand() {
  for (const candidate of ["python3", "python"]) {
    const result = spawnSync(candidate, ["--version"], {
      stdio: "ignore",
    });
    if (result.status === 0) {
      return candidate;
    }
  }

  throw new Error("Python is required to export the seeded saved-accounts fixture.");
}

export default async function globalSetup() {
  fs.mkdirSync(E2E_GENERATED_DIR, { recursive: true });

  const python = resolvePythonCommand();
  const result = spawnSync(
    python,
    [EXPORT_SCRIPT_PATH, SEEDED_DB_PATH, SEEDED_JSON_PATH],
    {
      stdio: "inherit",
    }
  );

  if (result.status !== 0) {
    throw new Error("Failed to export the seeded saved-accounts fixture.");
  }
}
