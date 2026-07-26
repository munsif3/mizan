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

async function waitForWorkspace(page: Page): Promise<void> {
  await expect(page.getByRole("navigation", { name: "Primary" })).toBeVisible();
  await expect(page.locator(".sync-chip")).toBeVisible();
}

/**
 * A household write is debounced for 250 ms. Waiting past that boundary before
 * asserting "Synced" prevents an already-synced pre-edit chip from satisfying
 * the assertion before the write has started.
 */
async function waitForCloudSave(page: Page): Promise<void> {
  await page.waitForTimeout(350);
  await expect(page.locator(".sync-chip")).toHaveText("Synced", { timeout: 15_000 });
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

async function openView(
  page: Page,
  name: "Home" | "Transactions" | "History",
): Promise<void> {
  const headings = {
    Home: "Money check-in",
    Transactions: "Transactions",
    History: "Month by month",
  } as const;
  const navigation = page.getByRole("navigation", { name: "Primary" });
  await activate(navigation.getByRole("button", { name, exact: true }));
  await expect(page.getByRole("heading", { name: headings[name], exact: true })).toBeVisible();
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
  await expect(page.getByRole("heading", { name: "Money check-in", exact: true })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-theme", projectTheme(testInfo));
  await waitForCloudSave(page);
}

async function selectSettingsTab(
  settingsDialog: Locator,
  tabValue: string,
  tabLabel: string,
): Promise<void> {
  const compactSelect = settingsDialog.getByLabel("Settings section");
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

function homeSpendMetric(page: Page): Locator {
  return page.locator(".financial-strip > div").filter({ hasText: "Recorded spend" });
}

function historySpendMetric(page: Page): Locator {
  return page.locator(".selected-month-metrics > div").filter({ hasText: "Spend" });
}

async function openTransaction(page: Page, description: string): Promise<Locator> {
  await activate(page.getByRole("button", { name: `Open details for ${description}`, exact: true }));
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
  await expect(page.getByText("Alex", { exact: true }).first()).toBeVisible();

  await page.reload();
  await waitForWorkspace(page);
  await expect(page.getByRole("heading", { name: "Money check-in", exact: true })).toBeVisible();
  await expect(page.getByText("Alex", { exact: true }).first()).toBeVisible();

  await assertNoSeriousAxeViolations(page);
  await capture(page, testInfo, "solo-household-after-reload");
});

test("imports activity, confirms coverage, classifies a merchant, and completes the weekly check-in", async ({ page }, testInfo) => {
  await setupSoloHousehold(page, testInfo);
  await addAccount(page);

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
  await activate(csvDialog.getByRole("button", { name: "Confirm coverage" }));
  await expect(csvDialog.getByRole("button", { name: "Coverage confirmed" })).toBeDisabled();
  await activate(csvDialog.getByRole("button", { name: "Close", exact: true }));

  await expect(page.getByRole("heading", { name: "Transactions", exact: true })).toBeVisible();
  const reviewCard = page.locator(".merchant-review-card").filter({ hasText: IMPORTED_MERCHANT });
  await expect(reviewCard).toBeVisible();
  await expect(reviewCard.getByText("Who it was for", { exact: true })).toHaveCount(0);
  await expect(reviewCard.getByRole("button", { name: `Change movement for ${IMPORTED_MERCHANT}` })).toBeVisible();
  await chooseOption(reviewCard.getByLabel(`Category for ${IMPORTED_MERCHANT}`), { label: "Groceries" });
  await activate(reviewCard.getByRole("button", { name: `Save merchant default for ${IMPORTED_MERCHANT}` }));
  await expect(reviewCard).toBeHidden();

  await openView(page, "Home");
  await activate(page.getByRole("button", { name: "Mark reviewed", exact: true }));
  await expect(page.locator(".workspace-alert")).toContainText("Weekly money check-in recorded");
  await waitForCloudSave(page);

  await assertNoSeriousAxeViolations(page);
  await capture(page, testInfo, "weekly-check-in-complete");
});

test("adds, edits, and deletes a transaction with reload-stable Home and History totals", async ({ page }, testInfo) => {
  await setupSoloHousehold(page, testInfo);
  const date = todayIso();

  await activate(page.locator(".page-actions").getByRole("button", { name: "Add transaction" }));
  const addDialog = page.getByRole("dialog", { name: "Add transaction" });
  await enterText(addDialog.getByLabel("Date"), date);
  await enterText(addDialog.getByLabel("Amount"), "125.50");
  await enterText(addDialog.getByLabel("Description"), MANUAL_MERCHANT);
  await chooseOption(addDialog.getByLabel("Category"), { label: "Dining" });
  await enterText(addDialog.getByLabel("Account name"), "Cash Wallet");
  await activate(addDialog.getByRole("button", { name: "Add transaction" }));
  await expect(addDialog).toBeHidden();
  await waitForCloudSave(page);
  await expect(homeSpendMetric(page)).toContainText("125");

  await openView(page, "Transactions");
  let drawer = await openTransaction(page, MANUAL_MERCHANT);
  await chooseOption(drawer.getByLabel(`Category for ${MANUAL_MERCHANT}`), "food");
  await expect(drawer.getByLabel(`Category for ${MANUAL_MERCHANT}`)).toHaveValue("food");
  await activate(drawer.getByRole("button", { name: `Close ${MANUAL_MERCHANT}` }));
  await waitForCloudSave(page);

  await openView(page, "History");
  await expect(historySpendMetric(page)).toContainText("125");
  await capture(page, testInfo, "history-after-edit");

  await page.reload();
  await waitForWorkspace(page);
  await openView(page, "Transactions");
  drawer = await openTransaction(page, MANUAL_MERCHANT);
  await expect(drawer.getByLabel(`Category for ${MANUAL_MERCHANT}`)).toHaveValue("food");
  await activate(drawer.getByRole("button", { name: `Close ${MANUAL_MERCHANT}` }));

  await openView(page, "Home");
  await expect(homeSpendMetric(page)).toContainText("125");
  await openView(page, "History");
  await expect(historySpendMetric(page)).toContainText("125");
  await capture(page, testInfo, "home-and-history-after-reload");

  await openView(page, "Transactions");
  drawer = await openTransaction(page, MANUAL_MERCHANT);
  await activate(drawer.getByRole("button", { name: "Delete transaction", exact: true }));
  const deleteDialog = page.getByRole("dialog", { name: "Delete transaction" });
  await expect(deleteDialog).toBeVisible();
  await activate(deleteDialog.getByRole("button", { name: "Delete transaction", exact: true }));
  await waitForCloudSave(page);

  await page.reload();
  await waitForWorkspace(page);
  await openView(page, "Transactions");
  await expect(page.getByText(MANUAL_MERCHANT, { exact: true })).toHaveCount(0);
  await openView(page, "Home");
  await expect(homeSpendMetric(page)).toContainText(/0(?:[.,]00)?/);
  await openView(page, "History");
  await expect(historySpendMetric(page)).toContainText(/0(?:[.,]00)?/);

  await assertNoSeriousAxeViolations(page);
  await capture(page, testInfo, "after-delete-and-reload");
});
