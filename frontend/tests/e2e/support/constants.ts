import path from "node:path";
import { fileURLToPath } from "node:url";

const SUPPORT_DIR = path.dirname(fileURLToPath(import.meta.url));

export const PREVIEW_PORT = 43173;
export const E2E_ROOT = path.resolve(SUPPORT_DIR, "..");
export const E2E_FIXTURES_DIR = path.join(E2E_ROOT, "fixtures");
export const E2E_GENERATED_DIR = path.join(E2E_ROOT, ".generated");
export const SEEDED_DB_PATH = path.join(E2E_FIXTURES_DIR, "saved-accounts.seed.sqlite");
export const SEEDED_JSON_PATH = path.join(E2E_FIXTURES_DIR, "saved-accounts.seed.json");
