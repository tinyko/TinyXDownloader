import { expect, type Page } from "@playwright/test";

import { installWailsHarness, type IntegrityPlan } from "./wails-harness";

export async function openApp(page: Page, integrityPlans?: IntegrityPlan[]) {
  await installWailsHarness(page, {
    integrityPlans,
  });
  await page.goto("/");
  await expect(page.getByTestId("workspace-tab-fetch")).toBeVisible();
}

export async function openSavedWorkspace(page: Page) {
  await page.getByTestId("workspace-tab-saved").click();
  await expect(page.getByTestId("saved-account-view-public")).toBeVisible();
}

export async function openHistoryWorkspace(page: Page) {
  await page.getByTestId("workspace-tab-history").click();
  await expect(page.getByTestId("task-history-workspace")).toBeVisible();
}

export async function chooseSelectItem(
  page: Page,
  triggerTestId: string,
  optionName: RegExp | string
) {
  await page.getByTestId(triggerTestId).click();
  await page.getByRole("option", { name: optionName }).click();
}

export async function waitForTaskStatus(
  page: Page,
  testId: string,
  expected: string
) {
  await expect(page.getByTestId(testId)).toHaveText(expected, {
    timeout: 10_000,
  });
}

export async function waitForTaskStatusOneOf(
  page: Page,
  testId: string,
  expected: string[]
) {
  await expect
    .poll(async () => {
      const value = (await page.getByTestId(testId).textContent())?.trim() ?? "";
      return expected.includes(value);
    }, {
      timeout: 10_000,
    })
    .toBe(true);
}
