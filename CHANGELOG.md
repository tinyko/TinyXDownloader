# Changelog

## V1.2.1 - 2026-04-14

- refactored the Wails bridge into focused app entrypoints for accounts, downloads, extraction, integrity, and tools
- shipped Saved Accounts bootstrap, filtered query pagination, matching-id lookup, and ID-based account hydration for the database workspace
- added background Download Integrity task flow with quick/deep modes, progress polling, cancellation, and report display in Settings
- tightened frontend lint coverage by excluding generated `wailsjs` output and fixing React/compiler, typing, and state-management issues across the workspace
