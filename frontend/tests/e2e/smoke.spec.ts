import { expect, test } from "@playwright/test";

import {
  chooseSelectItem,
  openApp,
  openSavedWorkspace,
  waitForTaskStatus,
  waitForTaskStatusOneOf,
} from "./support/test-helpers";

test("saved accounts workspace smoke covers search, filters, toggles, and load more", async ({
  page,
}) => {
  await openApp(page);
  await openSavedWorkspace(page);

  await expect(page.getByTestId("saved-account-view-public")).toContainText("Public (120)");
  await expect(page.getByTestId("saved-account-view-private")).toContainText("Private (2)");
  await expect(page.getByTestId("saved-account-row-alpha120")).toBeVisible();

  await page.getByTestId("saved-search-input").fill("alpha005");
  await expect(page.getByTestId("saved-account-row-alpha005")).toBeVisible();

  await page.getByTestId("saved-search-input").fill("");
  await chooseSelectItem(page, "saved-media-filter-trigger", /Videos/i);
  await expect(page.getByTestId("saved-account-row-alpha117")).toBeVisible();

  await chooseSelectItem(page, "saved-group-filter-trigger", /Creators/i);
  await expect(page.getByTestId("saved-account-row-alpha037")).toBeVisible();

  await page.getByTestId("saved-view-gallery").click();
  await expect(page.getByTestId("saved-accounts-gallery")).toBeVisible();

  await page.getByTestId("saved-view-list").click();
  await expect(page.getByTestId("saved-accounts-list")).toBeVisible();

  await chooseSelectItem(page, "saved-media-filter-trigger", /All Types/i);
  await chooseSelectItem(page, "saved-group-filter-trigger", /All Groups/i);
  await expect(page.getByTestId("saved-load-more")).toBeVisible();
  await page.getByTestId("saved-load-more").click();
  await expect(page.getByTestId("saved-load-more")).toHaveCount(0);

  await page.getByTestId("saved-account-view-private").click();
  await expect(page.getByTestId("saved-account-row-bookmarks")).toBeVisible();
  await expect(page.getByTestId("saved-account-row-likes")).toBeVisible();
});

test("activity panel smoke covers fetch, download, and integrity lifecycle flows", async ({
  page,
}) => {
  await openApp(page, [
    {
      mode: "quick",
      outcome: "completed",
      checkedFiles: 18,
      issueCount: 0,
      settleAfterPolls: 2,
    },
    {
      mode: "deep",
      outcome: "completed",
      checkedFiles: 24,
      issueCount: 1,
      settleAfterPolls: 3,
    },
    {
      mode: "quick",
      outcome: "failed",
      checkedFiles: 12,
      error: "remote manifest unavailable",
      settleAfterPolls: 2,
    },
  ]);

  const primaryFetchAction = page.getByTestId("fetch-primary-action");
  await page.getByTestId("fetch-input-textarea").fill("smokeuser");
  await expect(primaryFetchAction).toBeEnabled();
  await primaryFetchAction.click();

  await waitForTaskStatus(page, "activity-fetch-status", "Running");
  await page.getByTestId("activity-fetch-cancel").click();
  await waitForTaskStatusOneOf(page, "activity-fetch-status", ["Cancelling", "Cancelled"]);
  await waitForTaskStatus(page, "activity-fetch-status", "Cancelled");

  await page.getByTestId("fetch-input-textarea").fill("multi-a\nmulti-b\nmulti-c");
  await primaryFetchAction.click();

  await waitForTaskStatus(page, "activity-fetch-status", "Running");
  await page.getByTestId("activity-fetch-cancel").click();
  await waitForTaskStatusOneOf(page, "activity-fetch-status", ["Cancelling", "Cancelled"]);
  await waitForTaskStatus(page, "activity-fetch-status", "Cancelled");

  await openSavedWorkspace(page);
  await page.getByTestId("saved-account-download-alpha120").click();
  await waitForTaskStatus(page, "activity-download-status", "Running");
  await page.getByTestId("activity-download-cancel").click();
  await waitForTaskStatusOneOf(page, "activity-download-status", ["Cancelling", "Cancelled"]);
  await waitForTaskStatus(page, "activity-download-status", "Cancelled");
  await expect(
    page.locator('[data-testid^="activity-download-history-status-"]').first()
  ).toHaveText("Cancelled");

  await page.getByTestId("open-settings").click();
  await expect(page.getByTestId("integrity-trigger")).toBeVisible();

  await page.getByTestId("integrity-trigger").click();
  await page.getByTestId("integrity-action-quick").click();
  await waitForTaskStatus(page, "activity-integrity-status", "Running");
  await waitForTaskStatus(page, "activity-integrity-status", "Completed");
  await page
    .locator('[role="dialog"]')
    .filter({ has: page.getByText("Download Integrity Report") })
    .getByRole("button", { name: "Close" })
    .first()
    .click();

  await page.getByTestId("integrity-trigger").click();
  await page.getByTestId("integrity-action-deep").click();
  await waitForTaskStatus(page, "activity-integrity-status", "Running");
  await page.getByTestId("integrity-cancel").click();
  await waitForTaskStatusOneOf(page, "activity-integrity-status", ["Cancelling", "Cancelled"]);
  await waitForTaskStatus(page, "activity-integrity-status", "Cancelled");

  await page.getByTestId("integrity-trigger").click();
  await page.getByTestId("integrity-action-quick").click();
  await waitForTaskStatus(page, "activity-integrity-status", "Running");
  await waitForTaskStatus(page, "activity-integrity-status", "Failed");
  await expect(page.getByText("integrity check failed: remote manifest unavailable")).toBeVisible();
});
