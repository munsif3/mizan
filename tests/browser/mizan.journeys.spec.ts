import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page, type TestInfo } from "@playwright/test";

type Theme = "light" | "dark";

const ACCOUNT = "Weekly Checking";
const IMPORTED_MERCHANT = "KEELLS";
const MANUAL_MERCHANT = "JOURNEY COFFEE";

function projectTheme(testInfo: TestInfo): Theme {
  return testInfo.project.metadata.theme === "dark" ? "dark" : "light";
}

function safeSlug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function testIdentity(testInfo: TestInfo): string {
  const key = safeSlug(`${testInfo.project.name}-${testInfo.titlePath.join("-")}`).slice(0, 72);
  return `${key}@example.test`;
}

function todayIso(): string {
  const today = new Date();
  return [
    today.getFullYear(),
    String(today.getMonth() + 1).padStart(2, "0"),
    String(today.getDate()).padStart(2, "0"),
  ].join("-");
}

function dayFirst(isoDate: string): string {
  const [year, month, day] = isoDate.split("-");
  return `${day}/${month}/${year}`;
}

async function activate(locator: Locator): Promise<void> {
  const target = locator.first();
  await expect(target).toBeVisible();
  await expect(target).toBeEnabled();
  await target.focus();
  await expect(target).toBeFocused();
  await target.press("Enter");
}

async function enterText(locator: Locator, value: string): Promise<void> {
  await expect(locator).toBeVisible();
  await locator.focus();
  await expect(locator).toBeFocused();
  await locator.fill(value);
}

async function chooseOption(locator: Locator, option: string | { label: string }): Promise<void> {
  await expect(locator).toBeVisible();
  await locator.focus();
  await expect(locator).toBeFocused();
  await locator.selectOption(option);
}

function syncChip(page: Page): Locator {
  return page.locator(".sync-chip").first();
}

function balanceConfidenceChip(page: Page): Locator {
  return page.locator(".balance-confidence-chip").first();
}

async function waitForWorkspace(page: Page): Promise<void> {
  await expect(page.getByRole("navigation", { name: "Primary" })).toBeVisible();
  if (await syncChip(page).count()) {
    await expect(syncChip(page)).toHaveText(/Synced|Syncing/);
  } else {
    await expect(balanceConfidenceChip(page)).toBeVisible();
  }
}

/**
 * A household write is debounced for 250 ms. Waiting past that boundary before
 * asserting "Synced" prevents an already-synced pre-edit chip from satisfying
 * the assertion before the write has started.
 */
async function waitForCloudSave(page: Page): Promise<void> {
  await page.waitForTimeout(350);
  if (await syncChip(page).count()) {
    await expect(syncChip(page)).toHaveText("Synced", { timeout: 15_000 });
  } else {
    await expect(balanceConfidenceChip(page)).toHaveAttribute("title", /^Synced/, { timeout: 15_000 });
  }
}

async function assertNoSeriousAxeViolations(page: Page): Promise<void> {
  const result = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  const violations = result.violations
    .filter((violation) => violation.impact === "serious" || violation.impact === "critical")
    .map((violation) => ({
      id: violation.id,
      impact: violation.impact,
      help: violation.help,
      targets: violation.nodes.map((node) => node.target),
    }));
  expect(violations, JSON.stringify(violations, null, 2)).toEqual([]);
}

async function capture(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  await testInfo.attach(name, {
    body: await page.screenshot({ fullPage: true }),
    contentType: "image/png",
  });
}

async function expectHorizontalInset(parent: Locator, child: Locator, minimum: number): Promise<void> {
  const [parentBox, childBox] = await Promise.all([parent.boundingBox(), child.boundingBox()]);
  expect(parentBox).not.toBeNull();
  expect(childBox).not.toBeNull();
  expect(childBox!.x - parentBox!.x).toBeGreaterThanOrEqual(minimum);
  expect((parentBox!.x + parentBox!.width) - (childBox!.x + childBox!.width)).toBeGreaterThanOrEqual(minimum);
}

async function openView(
  page: Page,
  name: "Balance" | "Sort" | "Ledger" | "Trend",
): Promise<void> {
  const navigation = page.getByRole("navigation", { name: "Primary" });
  const destination = navigation.getByRole("button", { name: new RegExp(`^${name}(?:,|$)`) });
  await activate(destination);
  await expect(destination).toHaveAttribute("aria-current", "page");
  if (name === "Ledger" || name === "Trend") {
    await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
  }
}

async function setupSoloHousehold(
  page: Page,
  testInfo: TestInfo,
  options: { captureOnboarding?: boolean } = {},
): Promise<void> {
  const email = testIdentity(testInfo);
  const householdName = `${testInfo.project.name} household`;

  await page.goto("/");
  await page.waitForFunction(() =>
    typeof (globalThis as typeof globalThis & {
      __mizanEmulatorSignIn?: (email: string) => Promise<void>;
    }).__mizanEmulatorSignIn === "function");
  await page.evaluate(async (identity) => {
    const signIn = (globalThis as typeof globalThis & {
      __mizanEmulatorSignIn?: (email: string) => Promise<void>;
    }).__mizanEmulatorSignIn;
    if (!signIn) throw new Error("The Firebase emulator sign-in hook is unavailable.");
    await signIn(identity);
  }, email);

  await expect(page.getByRole("heading", { name: "Choose a Firestore household" })).toBeVisible();
  await activate(page.getByRole("button", { name: "Create household", exact: true }));

  const createDialog = page.getByRole("dialog", { name: "Create a household" });
  await enterText(createDialog.getByLabel("Household name"), householdName);
  await activate(createDialog.getByRole("button", { name: "Create household", exact: true }));

  const onboarding = page.locator(".onboard-form");
  await expect(page.getByRole("heading", { name: "Set up your household" })).toBeVisible();
  await expect(onboarding.locator("label.field")).toHaveCount(4);
  await expect(onboarding).not.toContainText(/locale|colou?r|beneficiary|funding owner/i);
  await enterText(onboarding.getByLabel("Name", { exact: true }), "Alex");
  await enterText(onboarding.getByLabel("Monthly take-home"), "5000");
  await enterText(onboarding.getByLabel("Currency", { exact: true }), "LKR");
  await enterText(onboarding.getByLabel("Savings target (%)"), "25");

  if (options.captureOnboarding) {
    await assertNoSeriousAxeViolations(page);
    await capture(page, testInfo, "minimal-onboarding");
  }

  await activate(onboarding.getByRole("button", { name: "Get started" }));
  await waitForWorkspace(page);
  await expect(page.getByRole("button", { name: "Balance", exact: true })).toHaveAttribute("aria-current", "page");
  await expect(page.locator("html")).toHaveAttribute("data-theme", projectTheme(testInfo));
  await waitForCloudSave(page);
}

async function selectSettingsTab(
  settingsDialog: Locator,
  tabValue: string,
  tabLabel: string,
): Promise<void> {
  const compactSelect = settingsDialog.getByRole("combobox", { name: "Settings section", exact: true });
  if (await compactSelect.isVisible()) {
    await chooseOption(compactSelect, tabValue);
    return;
  }
  await activate(settingsDialog.getByRole("tab", { name: tabLabel, exact: true }));
}

async function addAccount(page: Page): Promise<void> {
  await activate(page.getByRole("button", { name: "Settings", exact: true }));
  const settings = page.getByRole("dialog", { name: "Settings" });
  await expect(settings).toBeVisible();
  await selectSettingsTab(settings, "accounts", "Accounts & rules");
  await activate(settings.getByRole("button", { name: "Add account" }));
  await enterText(settings.getByLabel("Account label"), ACCOUNT);
  await activate(settings.getByRole("button", { name: "Save account" }));
  await expect(settings.getByText(ACCOUNT, { exact: true })).toBeVisible();
  await waitForCloudSave(page);
  await activate(settings.getByRole("button", { name: "Close Settings" }));
  await expect(settings).toBeHidden();
}

function balanceSpendMetric(page: Page): Locator {
  return page.getByRole("img", { name: /^Spent:/ });
}

function trendSpendMetric(page: Page): Locator {
  return page.locator(".selected-month-metrics > div").filter({ hasText: "Spend" });
}

async function openTransaction(page: Page, description: string): Promise<Locator> {
  const tableControl = page.getByRole("button", { name: `Open details for ${description}`, exact: true });
  const cardControl = page.locator(".transaction-card-open").filter({ hasText: description });
  await activate(await tableControl.isVisible() ? tableControl : cardControl);
  const drawer = page.getByRole("dialog", { name: description });
  await expect(drawer).toBeVisible();
  return drawer;
}

test.beforeEach(async ({ page }, testInfo) => {
  const theme = projectTheme(testInfo);
  await page.addInitScript((savedTheme) => {
    localStorage.setItem("mizan.theme", savedTheme);
  }, theme);
});

test("signs in, creates a solo household, and finishes minimal onboarding", async ({ page }, testInfo) => {
  await setupSoloHousehold(page, testInfo, { captureOnboarding: true });
  await expect(page.locator("html")).toHaveAttribute("data-theme", projectTheme(testInfo));
  await expect(page.locator('[title="Alex"]').first()).toBeVisible();

  await page.reload();
  await waitForWorkspace(page);
  await expect(page.getByRole("button", { name: "Balance", exact: true })).toHaveAttribute("aria-current", "page");
  await expect(page.locator('[title="Alex"]').first()).toBeVisible();

  await assertNoSeriousAxeViolations(page);
  await capture(page, testInfo, "solo-household-after-reload");
});

test("imports activity, confirms coverage, classifies a merchant, and completes the weekly check-in", async ({ page }, testInfo) => {
  await setupSoloHousehold(page, testInfo);
  await addAccount(page);

  await openView(page, "Ledger");
  await activate(page.locator(".page-actions").getByRole("button", { name: "Import activity" }));
  const importDialog = page.getByRole("dialog", { name: "Import" });
  await activate(importDialog.getByRole("tab", { name: "CSV export" }));

  const date = todayIso();
  const csv = [
    "Date,Description,Amount,Account",
    `${dayFirst(date)},${IMPORTED_MERCHANT},42.75,${ACCOUNT}`,
  ].join("\n");
  await importDialog.locator('input[type="file"]').setInputFiles({
    name: "weekly-checking.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(csv),
  });

  const csvDialog = page.getByRole("dialog", { name: "Import CSV" });
  await expect(csvDialog).toContainText("1 row ready");
  await activate(csvDialog.getByRole("button", { name: "Import 1 transaction" }));
  await expect(csvDialog.getByText("Confirm account coverage", { exact: true })).toBeVisible();
  await csvDialog.getByRole("button", { name: "Confirm coverage" }).click();
  await expect(csvDialog.getByRole("button", { name: "Coverage confirmed" })).toBeDisabled();
  await activate(csvDialog.getByRole("button", { name: "Close", exact: true }));

  await expect(page.getByRole("button", { name: /^Sort(?:,|$)/ })).toHaveAttribute("aria-current", "page");
  const sortCard = page.locator(".sort-card").filter({ hasText: IMPORTED_MERCHANT }).first();
  await expect(sortCard).toBeVisible();
  await expect(sortCard.getByText("Who for", { exact: true })).toHaveCount(0);
  await expect(sortCard.getByRole("button", { name: /Groceries/ })).toBeVisible();
  await page.keyboard.press("1");
  await page.keyboard.press("Enter");
  await expect(sortCard).toBeHidden();

  await openView(page, "Ledger");
  const ledgerPanel = page.locator(".transactions-panel");
  await expectHorizontalInset(ledgerPanel, ledgerPanel.locator(".table-toolbar"), 14);
  await capture(page, testInfo, "ledger-spacing");

  await openView(page, "Balance");
  await activate(page.getByRole("button", { name: "Open the books", exact: true }));
  const booksDisclosure = page.locator(".books-content > .disclosure");
  const purposeSection = booksDisclosure.locator(".attribution-section");
  await expectHorizontalInset(booksDisclosure, purposeSection, 10);
  await expectHorizontalInset(purposeSection, purposeSection.locator(".attribution-heading"), 14);
  const booksSections = booksDisclosure.locator(".disclosure-panel > section");
  if (await booksSections.count() > 1) {
    const sectionBoxes = await booksSections.evaluateAll((sections) =>
      sections.map((section) => {
        const box = section.getBoundingClientRect();
        return { top: box.top, bottom: box.bottom, width: box.width };
      }));
    expect(sectionBoxes[1]!.top - sectionBoxes[0]!.bottom).toBeGreaterThanOrEqual(14);
    expect(Math.abs(sectionBoxes[1]!.width - sectionBoxes[0]!.width)).toBeLessThanOrEqual(1);
  }
  await capture(page, testInfo, "books-purpose-spacing");
  await activate(page.locator(".books-back"));
  await activate(page.getByRole("button", { name: "Continue", exact: true }));
  await expect(page.getByRole("heading", { name: "A short reading of the household.", exact: true })).toBeVisible();
  await activate(page.getByRole("button", { name: /^Accounts current/ }));
  await activate(page.getByRole("button", { name: /^Sorting answered/ }));
  await activate(page.getByRole("button", { name: /^I've read this/ }));
  await activate(page.getByRole("button", { name: "Nothing this week, thanks", exact: true }));
  await expect(page.getByRole("heading", { name: /Week \d+ is closed\./ })).toBeVisible();
  await waitForCloudSave(page);

  await assertNoSeriousAxeViolations(page);
  await capture(page, testInfo, "weekly-check-in-complete");
});

test("adds, edits, and deletes a transaction with reload-stable Balance and Trend totals", async ({ page }, testInfo) => {
  await setupSoloHousehold(page, testInfo);
  const date = todayIso();

  await openView(page, "Ledger");
  await activate(page.locator(".page-actions").getByRole("button", { name: "Add transaction" }));
  const addDialog = page.getByRole("dialog", { name: "Add transaction" });
  await enterText(addDialog.getByLabel("Date"), date);
  await enterText(addDialog.getByLabel("Amount"), "125.50");
  await enterText(addDialog.getByLabel("Description"), MANUAL_MERCHANT);
  await chooseOption(addDialog.getByLabel("Category"), { label: "Dining" });
  await enterText(addDialog.getByLabel("Account name"), "Cash Wallet");
  await activate(addDialog.getByRole("button", { name: "Add transaction", exact: true }));
  await expect(addDialog).toBeHidden();
  await waitForCloudSave(page);
  await openView(page, "Balance");
  await expect(balanceSpendMetric(page)).toHaveAccessibleName(/126/);

  await openView(page, "Ledger");
  let drawer = await openTransaction(page, MANUAL_MERCHANT);
  await chooseOption(drawer.getByLabel(`Category for ${MANUAL_MERCHANT}`), "food");
  await expect(drawer.getByLabel(`Category for ${MANUAL_MERCHANT}`)).toHaveValue("food");
  await activate(drawer.getByRole("button", { name: `Close ${MANUAL_MERCHANT}` }));
  await waitForCloudSave(page);

  await openView(page, "Trend");
  await expect(trendSpendMetric(page)).toContainText("126");
  await capture(page, testInfo, "trend-after-edit");

  await page.reload();
  await waitForWorkspace(page);
  await openView(page, "Ledger");
  drawer = await openTransaction(page, MANUAL_MERCHANT);
  await expect(drawer.getByLabel(`Category for ${MANUAL_MERCHANT}`)).toHaveValue("food");
  await activate(drawer.getByRole("button", { name: `Close ${MANUAL_MERCHANT}` }));

  await openView(page, "Balance");
  await expect(balanceSpendMetric(page)).toHaveAccessibleName(/126/);
  await openView(page, "Trend");
  await expect(trendSpendMetric(page)).toContainText("126");
  await capture(page, testInfo, "balance-and-trend-after-reload");

  await openView(page, "Ledger");
  drawer = await openTransaction(page, MANUAL_MERCHANT);
  await activate(drawer.getByRole("button", { name: "Delete transaction", exact: true }));
  const deleteDialog = page.getByRole("dialog", { name: "Delete transaction" });
  await expect(deleteDialog).toBeVisible();
  await activate(deleteDialog.getByRole("button", { name: "Delete transaction", exact: true }));
  await waitForCloudSave(page);

  await page.reload();
  await waitForWorkspace(page);
  await openView(page, "Ledger");
  await expect(page.getByText(MANUAL_MERCHANT, { exact: true })).toHaveCount(0);
  await openView(page, "Balance");
  await expect(page.getByRole("region", { name: "Income accounted for" })).toContainText("No activity has been measured");
  await openView(page, "Trend");
  await expect(trendSpendMetric(page)).toContainText(/0(?:[.,]00)?/);

  await assertNoSeriousAxeViolations(page);
  await capture(page, testInfo, "after-delete-and-reload");
});
