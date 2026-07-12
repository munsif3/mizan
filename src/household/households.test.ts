import { describe, expect, it } from "vitest";
import type { AuthUser } from "../auth/authStore";
import { emptyData } from "../storage/schema";
import {
  appDataToCloudCollections,
  cloudCollectionsToAppData,
  createHouseholdMeta,
  hasLocalFinancialData,
  householdIdFromInvite,
  makeInviteCode,
  safeDocId,
} from "./households";

const user: AuthUser = {
  uid: "user_1",
  displayName: "Owner",
  email: "owner@example.com",
  photoURL: "",
};

describe("household helpers", () => {
  it("creates owner metadata without depending on app member names", () => {
    const meta = createHouseholdMeta(user, "Shared budget", "2026-07-09T00:00:00.000Z");
    expect(meta.name).toBe("Shared budget");
    expect(meta.ownerUid).toBe("user_1");
    expect(meta.membersByUid.user_1?.role).toBe("owner");
    expect(householdIdFromInvite(meta.inviteCode)).toBe(meta.id);
  });

  it("parses generated invite codes and rejects unrelated text", () => {
    const code = makeInviteCode("hh_abc123");
    expect(householdIdFromInvite(code)).toBe("hh_abc123");
    expect(householdIdFromInvite("not-an-invite")).toBeNull();
  });

  it("detects any financial or financial-adjacent AppData before cloud attach", () => {
    const empty = emptyData();
    expect(hasLocalFinancialData(empty)).toBe(false);
    expect(hasLocalFinancialData({ ...empty, settings: { ...empty.settings, members: [{ id: "a", name: "A", color: "#fff", portions: [] }] } })).toBe(true);
    expect(hasLocalFinancialData({ ...empty, merchantRules: { SHOP: { category: "food", kind: "expense" } } })).toBe(true);
    expect(hasLocalFinancialData({ ...empty, incomeReceipts: [{ id: "rcpt_2026-07_p", month: "2026-07", memberId: "m", portionId: "p", amount: 1 }] })).toBe(true);
    expect(hasLocalFinancialData({ ...empty, sharedContributions: [{ id: "c", allocations: [{ expenseTransactionId: "e", amount: 1 }], transferDebitTransactionId: "d", transferCreditTransactionId: "i", contributorMemberId: "m", amount: 1 }] })).toBe(true);
    expect(hasLocalFinancialData({ ...empty, settings: { ...empty.settings, fxRates: { USD: 305 } } })).toBe(true);
    expect(hasLocalFinancialData({ ...empty, settings: { ...empty.settings, csvPresets: { abc: { hasHeader: true, dateColumn: 0, dateOrder: "dmy", descriptionColumn: 1, amountMode: "single", amountColumn: 2 } } } })).toBe(true);
  });

  it("creates deterministic safe Firestore document ids for arbitrary keys", () => {
    const slashy = safeDocId("rule", "NTB / SHOP: Colombo #1");
    const long = safeDocId("csv", "Date,Description,Debit,Credit,Account/Branch ".repeat(40));
    expect(slashy).toBe(safeDocId("rule", "NTB / SHOP: Colombo #1"));
    expect(slashy).toMatch(/^rule_[a-z0-9]+_ntb_shop_colombo_1$/);
    expect(slashy).not.toContain("/");
    expect(long.length).toBeLessThanOrEqual(120);
    expect(long).not.toContain("/");
  });

  it("round-trips AppData through split cloud collections", () => {
    const data = emptyData();
    data.settings.members = [
      { id: "owner", name: "Owner", color: "#5b8cff", portions: [{ id: "por_owner", label: "Monthly income", amount: 1000, currency: "USD", taxRate: 0, taxWithheld: true, window: null }] },
      { id: "contributor", name: "Contributor", color: "#ff80b5", portions: [] },
    ];
    data.settings.currency = "USD";
    data.settings.locale = "en-US";
    data.settings.fxRates = { LKR: 0.0032 };
    data.settings.csvPresets = {
      signature_1: { hasHeader: true, dateColumn: 0, dateOrder: "ymd", descriptionColumn: 1, amountMode: "single", amountColumn: 2 },
    };
    data.settings.customCategories = [{ id: "cat1", label: "Pets", color: "#7b8194" }];
    data.settings.counterparties = [{ id: "cp1", name: "Friend" }];
    data.accounts = [
      { id: "acc1", label: "Card", currency: "USD", owner: "owner", match: ["1234"] },
      { id: "acc2", label: "Contributor Card", currency: "USD", owner: "contributor", match: ["5678"] },
    ];
    data.fixedCosts = [{ id: "fixed1", label: "Rent", amount: 100, category: "housing" }];
    data.incomeReceipts = [{ id: "rcpt_2026-07_por_owner", month: "2026-07", memberId: "owner", portionId: "por_owner", amount: 1100, transactionId: "txn1" }];
    data.merchantRules = { SHOP: { category: "custom:cat1", kind: "expense" } };
    data.transactions = [
      { id: "txn1", date: "2026-07-01", description: "SHOP", amount: 10, category: "custom:cat1", account: "Card", note: "", source: "imported", direction: "debit", kind: "expense" },
      { id: "out", date: "2026-07-02", description: "LOAN SHARE", amount: 40, category: "uncategorized", account: "Contributor Card", note: "", source: "imported", direction: "debit", kind: "internal_transfer" },
      { id: "in", date: "2026-07-02", description: "LOAN SHARE", amount: 40, category: "uncategorized", account: "Card", note: "", source: "imported", direction: "credit", kind: "internal_transfer" },
      { id: "loan", date: "2026-07-03", description: "LOAN FOR500240015943", amount: 60, category: "custom:cat1", account: "Card", note: "", source: "imported", direction: "debit", kind: "loan_payment" },
      { id: "loan2", date: "2026-07-04", description: "LOAN FOR500240015943", amount: 60, category: "custom:cat1", account: "Card", note: "", source: "imported", direction: "debit", kind: "loan_payment" },
    ];
    data.sharedContributions = [{ id: "c1", allocations: [{ expenseTransactionId: "loan", amount: 20 }, { expenseTransactionId: "loan2", amount: 20 }], transferDebitTransactionId: "out", transferCreditTransactionId: "in", contributorMemberId: "contributor", amount: 40 }];

    const cloud = appDataToCloudCollections(data, "user_1", "2026-07-09T00:00:00.000Z");
    expect(cloud.settings?.schemaVersion).toBe(4);
    expect(cloud.merchantRules[0]?.key).toBe("SHOP");
    expect(cloud.csvPresets[0]?.signature).toBe("signature_1");
    expect(cloud.incomeReceipts).toEqual(data.incomeReceipts);
    expect(cloud.sharedContributions).toEqual(data.sharedContributions);
    expect(cloud.settings?.fxRates).toEqual({ LKR: 0.0032 });
    expect(cloudCollectionsToAppData(cloud)).toEqual(data);
  });

  it("maps a full reset to empty split collections with valid settings", () => {
    const reset = emptyData();
    const cloud = appDataToCloudCollections(reset, "user_1", "2026-07-10T00:00:00.000Z");
    expect(cloud.settings?.schemaVersion).toBe(4);
    expect(cloud.transactions).toEqual([]);
    expect(cloud.sharedContributions).toEqual([]);
    expect(cloud.accounts).toEqual([]);
    expect(cloud.fixedCosts).toEqual([]);
    expect(cloud.incomeReceipts).toEqual([]);
    expect(cloud.members).toEqual([]);
    expect(cloud.customCategories).toEqual([]);
    expect(cloud.counterparties).toEqual([]);
    expect(cloud.merchantRules).toEqual([]);
    expect(cloud.csvPresets).toEqual([]);
    expect(cloudCollectionsToAppData(cloud)).toEqual(reset);
  });
});
