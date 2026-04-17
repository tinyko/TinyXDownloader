import { useEffect, useRef } from "react";

import {
  loadSavedAccountsBootstrap,
  querySavedAccountsPage,
} from "@/lib/database-client";
import { getRuntimeDefaults } from "@/lib/runtime-context";
import { WriteSmokeReport } from "../../../wailsjs/go/main/App";

interface SmokeReportPayload {
  ok: boolean;
  completed_at: string;
  steps: string[];
  error?: string;
}

function sleep(ms: number) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function setInputValue(
  element: HTMLInputElement | HTMLTextAreaElement,
  value: string
) {
  const prototype =
    element instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
  setter?.call(element, value);
  element.dispatchEvent(new Event("input", { bubbles: true }));
  element.dispatchEvent(new Event("change", { bubbles: true }));
}

function pressElement(element: HTMLElement) {
  const pointerEventCtor =
    typeof window.PointerEvent === "function" ? window.PointerEvent : window.MouseEvent;

  element.dispatchEvent(new pointerEventCtor("pointerdown", { bubbles: true, button: 0 }));
  element.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
  element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, button: 0 }));
  element.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0 }));
}

function queryElement<T extends Element>(selector: string): T | null {
  return document.querySelector(selector) as T | null;
}

async function waitForElement<T extends Element>(
  selector: string,
  timeoutMs = 12_000
): Promise<T> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const element = queryElement<T>(selector);
    if (element) {
      return element;
    }
    await sleep(100);
  }
  throw new Error(`Timed out waiting for ${selector}`);
}

async function waitForText(
  selector: string,
  matcher: RegExp,
  timeoutMs = 12_000
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const element = queryElement<HTMLElement>(selector);
    const text = element?.textContent?.trim() || "";
    if (matcher.test(text)) {
      return;
    }
    await sleep(100);
  }
  throw new Error(`Timed out waiting for ${selector} to match ${matcher}`);
}

async function clickAndWait(selector: string, nextSelector: string) {
  const button = await waitForElement<HTMLElement>(selector);
  pressElement(button);
  await waitForElement(nextSelector);
}

async function openSavedWorkspace() {
  pressElement(await waitForElement<HTMLElement>('[data-testid="workspace-tab-saved"]'));
  await waitForElement('[data-testid="saved-account-view-public"]');
}

async function resolveSavedAccountDownloadTarget(): Promise<string> {
  const [bootstrap, page] = await Promise.all([
    loadSavedAccountsBootstrap(),
    querySavedAccountsPage({
      accountViewMode: "public",
      searchQuery: "",
      filterGroup: "all",
      filterMediaType: "all",
      sortOrder: "newest",
      offset: 0,
      limit: 100,
    }),
  ]);

  if (!bootstrap || bootstrap.publicCount <= 0) {
    throw new Error("Saved accounts bootstrap returned no public accounts");
  }

  const firstAccount = page?.items?.[0];
  if (!firstAccount?.username) {
    throw new Error(
      `Saved accounts page returned no first item (public=${bootstrap.publicCount}, total=${page?.totalCount ?? 0})`
    );
  }

  const downloadSelector = `[data-testid="saved-account-download-${firstAccount.username}"]`;
  await waitForElement(
    '[data-testid="saved-accounts-list"], [data-testid="saved-accounts-gallery"]',
    30_000
  );

  const listToggle = queryElement<HTMLElement>('[data-testid="saved-view-list"]');
  if (listToggle) {
    pressElement(listToggle);
  }

  try {
    await waitForElement(downloadSelector, 15_000);
  } catch (error) {
    const galleryToggle = queryElement<HTMLElement>('[data-testid="saved-view-gallery"]');
    if (!galleryToggle) {
      throw error;
    }

    pressElement(galleryToggle);
    await waitForElement('[data-testid="saved-accounts-gallery"]', 5_000);
    await waitForElement(downloadSelector, 15_000);
  }

  return downloadSelector;
}

async function closeTopDialog() {
  const closeButton = await waitForElement<HTMLElement>(
    '[data-slot="dialog-content"] [data-slot="dialog-close"]'
  );
  pressElement(closeButton);
  await sleep(250);
}

async function ensureSettingsOpen() {
  const trigger = queryElement<HTMLElement>('[data-testid="integrity-trigger"]');
  if (trigger) {
    return trigger;
  }

  pressElement(await waitForElement<HTMLElement>('[data-testid="open-settings"]'));
  return waitForElement<HTMLElement>('[data-testid="integrity-trigger"]');
}

async function closeIntegrityReportDialog() {
  const start = Date.now();
  while (Date.now() - start < 12_000) {
    const dialogs = Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"]'));
    const reportDialog = dialogs.find((dialog) =>
      (dialog.textContent || "").includes("Download Integrity Report")
    );
    const closeButton = reportDialog?.querySelector<HTMLElement>('[data-slot="dialog-close"]');
    if (reportDialog && closeButton) {
      pressElement(closeButton);
      await sleep(250);
      return;
    }
    await sleep(100);
  }

  throw new Error("Timed out waiting to close the integrity report dialog");
}

async function writeSmokeReport(payload: SmokeReportPayload) {
  await WriteSmokeReport(JSON.stringify(payload, null, 2));
}

export function DesktopSmokeDriver() {
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) {
      return;
    }
    startedRef.current = true;

    const run = async () => {
      const runtimeDefaults = await getRuntimeDefaults();
      if (!runtimeDefaults.smokeMode) {
        return;
      }

      const steps: string[] = [];

      try {
        await waitForElement('[data-testid="workspace-tab-fetch"]');
        steps.push("app-ready");

        await clickAndWait('[data-testid="open-settings"]', "#settings-public-auth");
        setInputValue(await waitForElement<HTMLInputElement>("#settings-public-auth"), "smoke-public-token");
        setInputValue(await waitForElement<HTMLInputElement>("#settings-private-auth"), "smoke-private-token");
        steps.push("settings-opened");
        await closeTopDialog();

        await clickAndWait('[data-testid="open-diagnostics"]', '[data-testid="diagnostics-open-app-data"]');
        steps.push("diagnostics-opened");
        await closeTopDialog();

        setInputValue(
          await waitForElement<HTMLTextAreaElement>('[data-testid="fetch-input-textarea"]'),
          "smokeuser"
        );
        pressElement(await waitForElement<HTMLElement>('[data-testid="fetch-primary-action"]'));
        await waitForText('[data-testid="activity-fetch-status"]', /Running/i);
        pressElement(await waitForElement<HTMLElement>('[data-testid="activity-fetch-cancel"]'));
        await waitForText('[data-testid="activity-fetch-status"]', /Cancelled/i, 15_000);
        steps.push("fetch-cancelled");

        await openSavedWorkspace();
        const savedDownloadTarget = await resolveSavedAccountDownloadTarget();
        pressElement(await waitForElement<HTMLElement>(savedDownloadTarget));
        await waitForText('[data-testid="activity-download-status"]', /Running/i);
        pressElement(await waitForElement<HTMLElement>('[data-testid="activity-download-cancel"]'));
        await waitForText('[data-testid="activity-download-status"]', /Cancelled/i, 15_000);
        steps.push("download-cancelled");

        await ensureSettingsOpen();
        pressElement(await waitForElement<HTMLElement>('[data-testid="integrity-trigger"]'));
        pressElement(await waitForElement<HTMLElement>('[data-testid="integrity-action-quick"]'));
        await waitForText('[data-testid="activity-integrity-status"]', /Running/i);
        await waitForText('[data-testid="activity-integrity-status"]', /Completed/i, 15_000);
        steps.push("integrity-quick-completed");

        await closeIntegrityReportDialog();

        await ensureSettingsOpen();
        pressElement(await waitForElement<HTMLElement>('[data-testid="integrity-trigger"]'));
        pressElement(await waitForElement<HTMLElement>('[data-testid="integrity-action-deep"]'));
        await waitForText('[data-testid="activity-integrity-status"]', /Running/i);
        pressElement(await waitForElement<HTMLElement>('[data-testid="integrity-cancel"]'));
        await waitForText('[data-testid="activity-integrity-status"]', /Cancelled/i, 15_000);
        steps.push("integrity-deep-cancelled");

        await writeSmokeReport({
          ok: true,
          completed_at: new Date().toISOString(),
          steps,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await writeSmokeReport({
          ok: false,
          completed_at: new Date().toISOString(),
          steps,
          error: message,
        });
      }
    };

    void run();
  }, []);

  return null;
}
