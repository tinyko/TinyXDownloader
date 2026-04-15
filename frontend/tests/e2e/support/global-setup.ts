import fs from "node:fs";

import {
  E2E_GENERATED_DIR,
  SEEDED_JSON_PATH,
} from "./constants";

export default async function globalSetup() {
  fs.mkdirSync(E2E_GENERATED_DIR, { recursive: true });
  if (!fs.existsSync(SEEDED_JSON_PATH)) {
    throw new Error(`Missing saved-accounts fixture JSON: ${SEEDED_JSON_PATH}`);
  }
}
