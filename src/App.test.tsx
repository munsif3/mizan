import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import App from "./App";
import { computeMonthSummary } from "./domain/summary";
import type { AppData } from "./domain/types";
import { emptyData, migrate } from "./storage/schema";
import { HomeView } from "./ui/HomeView";
import { OnboardingView } from "./ui/OnboardingView";
import { SettingsModal } from "./ui/SettingsModal";

function threeMemberData(): AppData {
  const data = emptyData();
  data.settings.members = [
    { id: "a", name: "Ana", color: "#5b8cff", income: 500000 },
    { id: "b", name: "Ben", color: "#ff80b5", income: 400000 },
    { id: "c", name: "Cyd", color: "#f2b84b", income: 300000 },
  ];
  data.settings.currency = "USD";
  data.settings.locale = "en-US";
  data.accounts = [
    { id: "aa", label: "Ana Card", owner: "a", match: [] },
    { id: "bb", label: "Ben Card", owner: "b", match: [] },
  ];
  data.transactions = [
    { id: "t1", date: "2026-07-01", description: "RENT SHARE", amount: 90000, category: "housing", account: "Ana Card", note: "", source: "imported", direction: "debit" },
    { id: "t2", date: "2026-07-02", description: "GIFT FOR CYD", amount: 30000, category: "personal:c", account: "Ben Card", note: "", source: "imported", direction: "debit" },
  ];
  return data;
}

describe("UI render smoke", () => {
  it("renders onboarding without throwing", () => {
    expect(() => renderToString(<OnboardingView onComplete={() => {}} />)).not.toThrow();
  });

  it("renders the home view with N-member settlement", () => {
    const data = threeMemberData();
    const summary = computeMonthSummary(data, "2026-07", "all", new Date(2026, 6, 15));
    const html = renderToString(<HomeView summary={summary} money={(v) => `USD ${v}`} onOpenSettings={() => {}} />);
    expect(html).toContain("Ana");
    expect(html).toContain("Ben");
    // Someone must be settling up given uneven shared spend.
    expect(html).toMatch(/pays/);
  });

  it("renders settings with the members editor", () => {
    const data = threeMemberData();
    const html = renderToString(
      <SettingsModal
        data={data}
        onUpdateMembers={() => {}}
        onUpdateTarget={() => {}}
        onUpdateCurrency={() => {}}
        onUpdateFixedCosts={() => {}}
        onUpdateAccounts={() => {}}
        onDeleteRule={() => {}}
        onExport={() => {}}
        onImportBackup={() => {}}
        onClearData={() => {}}
        onClose={() => {}}
      />,
    );
    expect(html).toContain("Household members");
  });

  it("App shows onboarding on empty storage and the dashboard after migrating v4 couple data", () => {
    localStorage.clear();
    expect(renderToString(<App />)).toContain("Set up your household");

    const v4 = {
      schemaVersion: 4,
      transactions: [{ id: "x", date: "2026-07-01", description: "SHOP", amount: 1000, category: "food", account: "Alex Visa", direction: "debit", source: "imported" }],
      accounts: [{ id: "a1", label: "Alex Visa", owner: "munsif", match: [] }],
      merchantRules: {},
      fixedCosts: [],
      settings: { income: { munsif: 600000, sara: 800000 }, targetSaveRate: 25 },
    };
    localStorage.setItem("mizan_v2", JSON.stringify(migrate(v4)));
    const html = renderToString(<App />);
    expect(html).toContain("Munsif + Sara");
    localStorage.clear();
  });
});
