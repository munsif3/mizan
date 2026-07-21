import { describe, expect, it } from "vitest";
import type { AuthUser } from "../auth/authStore";
import { clearTransactionHistory } from "../domain/dataCleanup";
import { efficiencySubjectFingerprint } from "../domain/efficiency";
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
    expect(hasLocalFinancialData({ ...empty, merchantRules: { SHOP: { category: "food", beneficiary: { type: "household" }, kind: "expense" } } })).toBe(true);
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
      { id: "owner", name: "Owner", color: "#5b8cff", portions: [{ id: "por_owner", label: "Monthly income", amount: 1000, currency: "USD", taxRate: 0, taxWithheld: true, window: null, schedule: { frequency: "monthly" }, budgetTreatment: "ordinary" }] },
      { id: "contributor", name: "Contributor", color: "#ff80b5", portions: [] },
    ];
    data.settings.currency = "USD";
    data.settings.locale = "en-US";
    data.settings.fxRates = { LKR: 0.0032 };
    data.settings.csvPresets = {
      signature_1: { hasHeader: true, dateColumn: 0, dateOrder: "ymd", descriptionColumn: 1, amountMode: "single", amountColumn: 2, signConvention: "negative_is_credit" },
    };
    data.settings.customCategories = [{ id: "cat1", label: "Pets", color: "#7b8194" }];
    data.settings.counterparties = [{ id: "cp1", name: "Friend" }];
    data.accounts = [
      { id: "acc1", label: "Card", currency: "USD", owner: "owner", beneficiaryDefault: "owner", match: ["1234"] },
      { id: "acc2", label: "Contributor Card", currency: "USD", owner: "contributor", beneficiaryDefault: "review", match: ["5678"] },
    ];
    data.fixedCosts = [{ id: "fixed1", label: "Rent", amount: 100, kind: "loan_payment", category: "housing", beneficiary: { type: "household" } }];
    data.incomeReceipts = [{ id: "rcpt_2026-07_owner_por_owner", month: "2026-07", memberId: "owner", portionId: "por_owner", amount: 1100, transactionId: "txn1" }];
    data.merchantRules = { SHOP: { category: "custom:cat1", beneficiary: { type: "account_default" }, kind: "expense" } };
    data.transactions = [
      { id: "txn1", date: "2026-07-01", description: "SHOP", amount: 10, category: "custom:cat1", beneficiary: { type: "member", memberId: "owner" }, beneficiarySource: "account_default", account: "Card", accountId: "acc1", note: "", source: "imported", direction: "debit", kind: "expense" },
      { id: "out", date: "2026-07-02", description: "LOAN SHARE", amount: 40, category: "uncategorized", beneficiary: { type: "unassigned" }, account: "Contributor Card", note: "", source: "imported", direction: "debit", kind: "internal_transfer" },
      { id: "in", date: "2026-07-02", description: "LOAN SHARE", amount: 40, category: "uncategorized", beneficiary: { type: "unassigned" }, account: "Card", note: "", source: "imported", direction: "credit", kind: "internal_transfer" },
      { id: "loan", date: "2026-07-03", description: "LOAN FOR500240015943", amount: 60, category: "custom:cat1", beneficiary: { type: "household" }, account: "Card", note: "", source: "imported", direction: "debit", kind: "loan_payment" },
      { id: "loan2", date: "2026-07-04", description: "LOAN FOR500240015943", amount: 60, category: "custom:cat1", beneficiary: { type: "household" }, account: "Card", note: "", source: "imported", direction: "debit", kind: "loan_payment" },
    ];
    data.sharedContributions = [{ id: "c1", allocations: [{ expenseTransactionId: "loan", amount: 20 }, { expenseTransactionId: "loan2", amount: 20 }], transferDebitTransactionId: "out", transferCreditTransactionId: "in", contributorMemberId: "contributor", amount: 40 }];
    const subject = { type: "merchant", merchantKey: "SHOP", category: "custom:cat1", beneficiary: { type: "member", memberId: "owner" } } as const;
    data.efficiencyPlans = [{
      id: "plan1", fingerprint: efficiencySubjectFingerprint(subject), subject, subjectLabel: "Shop · Owner",
      value: "questionable", action: "reduce", effort: "easy", state: "planned",
      baseline: { months: ["2026-05", "2026-06"], monthlyAmount: 25, measurementScope: "merchant" },
      targetMonthlySavings: 10, targetMonth: "2026-08",
      createdAt: "2026-07-09T00:00:00.000Z", updatedAt: "2026-07-09T00:00:00.000Z",
    }];

    const cloud = appDataToCloudCollections(data, "user_1", "2026-07-09T00:00:00.000Z");
    expect(cloud.settings?.schemaVersion).toBe(8);
    expect(cloud.merchantRules[0]?.key).toBe("SHOP");
    expect(cloud.csvPresets[0]?.signature).toBe("signature_1");
    expect(cloud.incomeReceipts).toEqual(data.incomeReceipts);
    expect(cloud.sharedContributions).toEqual(data.sharedContributions);
    expect(cloud.efficiencyPlans).toEqual(data.efficiencyPlans);
    expect(cloud.settings?.fxRates).toEqual({ LKR: 0.0032 });
    expect(cloudCollectionsToAppData(cloud)).toEqual(data);
  });

  it("distinguishes pre-beneficiary cloud v4 data from current collections", () => {
    const data = cloudCollectionsToAppData({
      settings: {
        schemaVersion: 4 as never,
        targetSaveRate: 25,
        currency: "LKR",
        locale: "en-LK",
        fxRates: {},
        updatedAt: "2026-07-01T00:00:00.000Z",
        updatedBy: "user_1",
      },
      // Two members keeps this a test of the v4 pre-beneficiary distinction, not
      // of the one-member beneficiary backfill.
      members: [
        { id: "sara", name: "Sara", color: "#5b8cff", portions: [] },
        { id: "nina", name: "Nina", color: "#ff80b5", portions: [] },
      ],
      accounts: [{ id: "card", label: "Sara Card", owner: "sara", match: [] } as never],
      transactions: [{
        id: "unknown", date: "2026-07-01", description: "UNKNOWN", amount: 100,
        category: "uncategorized", account: "Sara Card", direction: "debit", kind: "expense", source: "imported", note: "",
      } as never],
    });
    expect(data.accounts[0]?.beneficiaryDefault).toBe("review");
    expect(data.transactions[0]?.beneficiary).toEqual({ type: "unassigned" });
  });

  it("defaults recurring commitment type when hydrating beneficiary-aware cloud v5 data", () => {
    const data = cloudCollectionsToAppData({
      settings: {
        schemaVersion: 5 as never,
        targetSaveRate: 25,
        currency: "LKR",
        locale: "en-LK",
        fxRates: {},
        updatedAt: "2026-07-01T00:00:00.000Z",
        updatedBy: "user_1",
      },
      fixedCosts: [{
        id: "rent",
        label: "Rent",
        amount: 100_000,
        category: "housing",
        beneficiary: { type: "household" },
      } as never],
    });
    expect(data.fixedCosts[0]?.kind).toBe("expense");
    expect(data.schemaVersion).toBe(15);
  });

  it("defaults cloud v6 income sources to monthly ordinary treatment", () => {
    const data = cloudCollectionsToAppData({
      settings: {
        schemaVersion: 6 as never,
        targetSaveRate: 25,
        currency: "LKR",
        locale: "en-LK",
        fxRates: {},
        updatedAt: "2026-07-01T00:00:00.000Z",
        updatedBy: "user_1",
      },
      members: [{
        id: "owner", name: "Owner", color: "#5b8cff",
        portions: [{ id: "salary", label: "Salary", amount: 1000, currency: "LKR", taxRate: 0, taxWithheld: true, window: null }],
      } as never],
      incomeReceipts: [{ id: "receipt", month: "2026-07", memberId: "owner", portionId: "salary", amount: 1000 }],
    });
    expect(data.settings.members[0]?.portions[0]).toMatchObject({
      schedule: { frequency: "monthly" }, budgetTreatment: "ordinary",
    });
    expect(data.incomeReceipts[0]).toMatchObject({
      label: "Salary", taxRate: 0, taxWithheld: true, budgetTreatment: "ordinary",
    });
    expect(data.schemaVersion).toBe(15);
  });

  it("rejects household data written by a newer cloud schema", () => {
    const settings = appDataToCloudCollections(emptyData(), "user_1").settings!;
    expect(() => cloudCollectionsToAppData({
      settings: { ...settings, schemaVersion: 9 as 8 },
    })).toThrow(/cloud schema v9.*update Mizan/i);
  });

  it("maps a full reset to empty split collections with valid settings", () => {
    const reset = emptyData();
    const cloud = appDataToCloudCollections(reset, "user_1", "2026-07-10T00:00:00.000Z");
    expect(cloud.settings?.schemaVersion).toBe(8);
    expect(cloud.transactions).toEqual([]);
    expect(cloud.sharedContributions).toEqual([]);
    expect(cloud.accounts).toEqual([]);
    expect(cloud.fixedCosts).toEqual([]);
    expect(cloud.incomeReceipts).toEqual([]);
    expect(cloud.efficiencyPlans).toEqual([]);
    expect(cloud.members).toEqual([]);
    expect(cloud.customCategories).toEqual([]);
    expect(cloud.counterparties).toEqual([]);
    expect(cloud.merchantRules).toEqual([]);
    expect(cloud.csvPresets).toEqual([]);
    expect(cloudCollectionsToAppData(cloud)).toEqual(reset);
  });

  it("maps a transaction-only clear without removing accounts or budget members", () => {
    const data = emptyData();
    data.settings.currency = "LKR";
    data.settings.members = [{ id: "owner", name: "Owner", color: "#5b8cff", portions: [] }];
    data.accounts = [{ id: "card", label: "Owner Card", owner: "owner", beneficiaryDefault: "owner", match: ["1234"] }];
    data.transactions = [{
      id: "txn", date: "2026-07-01", description: "SHOP", amount: 100, category: "food",
      beneficiary: { type: "household" }, account: "Owner Card", accountId: "card", note: "",
      source: "imported", direction: "debit", kind: "expense",
    }];
    data.sharedContributions = [{
      id: "contribution", allocations: [{ expenseTransactionId: "txn", amount: 100 }],
      transferDebitTransactionId: "out", transferCreditTransactionId: "in", contributorMemberId: "owner", amount: 100,
    }];
    data.incomeReceipts = [{
      id: "receipt", month: "2026-07", memberId: "owner", portionId: "salary", amount: 1000, transactionId: "txn",
    }];
    data.efficiencyPlans = [{
      id: "plan", fingerprint: "effsub_test",
      subject: { type: "category", category: "food", beneficiary: { type: "household" } },
      subjectLabel: "Food · Household", value: "worthwhile", action: "keep", effort: "moderate", state: "watching",
      baseline: { months: ["2026-05", "2026-06"], monthlyAmount: 100, measurementScope: "category" },
      targetMonthlySavings: 0, revisitAfterMonth: "2027-01",
      createdAt: "2026-07-14T00:00:00.000Z", updatedAt: "2026-07-14T00:00:00.000Z",
    }];

    const cloud = appDataToCloudCollections(clearTransactionHistory(data), "user_1", "2026-07-14T00:00:00.000Z");

    expect(cloud.transactions).toEqual([]);
    expect(cloud.sharedContributions).toEqual([]);
    expect(cloud.accounts).toEqual(data.accounts);
    expect(cloud.members).toEqual(data.settings.members);
    expect(cloud.incomeReceipts).toEqual([{ id: "receipt", month: "2026-07", memberId: "owner", portionId: "salary", amount: 1000 }]);
    expect(cloud.efficiencyPlans).toEqual(data.efficiencyPlans);
  });
});
