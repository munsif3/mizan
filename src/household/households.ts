import type { AuthUser } from "../auth/authStore";
import type { AppData } from "../domain/types";
import { migrate } from "../storage/schema";
import {
  CLOUD_HOUSEHOLD_SCHEMA_VERSION,
  type CloudCollections,
  type CloudCsvPreset,
  type CloudHousehold,
  type CloudMerchantRule,
  type CloudSettings,
  type HouseholdMeta,
} from "./types";

function randomToken(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID().replace(/-/g, "").slice(0, 16);
  return `${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-6)}`;
}

export function makeHouseholdId(): string {
  return `hh_${randomToken()}`;
}

export function makeInviteCode(householdId: string): string {
  return `${householdId}_${randomToken()}`;
}

export function householdIdFromInvite(code: string): string | null {
  const trimmed = code.trim();
  const match = trimmed.match(/^(hh_[a-z0-9]+)_[a-z0-9]+$/i);
  return match?.[1] ?? null;
}

export function hasLocalFinancialData(data: AppData): boolean {
  return Boolean(
    data.transactions.length ||
      Object.keys(data.merchantRules).length ||
      data.accounts.length ||
      data.fixedCosts.length ||
      data.incomeReceipts.length ||
      data.settings.members.length ||
      data.settings.counterparties.length ||
      data.settings.customCategories.length ||
      Object.keys(data.settings.csvPresets).length ||
      Object.keys(data.settings.fxRates).length ||
      data.settings.currency ||
      data.settings.locale ||
      data.settings.targetSaveRate !== 25,
  );
}

export function createHouseholdMeta(owner: AuthUser, name: string, now = new Date().toISOString()): HouseholdMeta {
  const id = makeHouseholdId();
  return {
    id,
    name: name.trim() || "Household",
    ownerUid: owner.uid,
    membersByUid: {
      [owner.uid]: {
        role: "owner",
        displayName: owner.displayName,
        email: owner.email,
        joinedAt: now,
      },
    },
    inviteCode: makeInviteCode(id),
    createdAt: now,
    updatedAt: now,
  };
}

function stableHash(value: string): string {
  let h1 = 0xdeadbeef ^ value.length;
  let h2 = 0x41c6ce57 ^ value.length;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    h1 = Math.imul(h1 ^ code, 2654435761);
    h2 = Math.imul(h2 ^ code, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return `${(h2 >>> 0).toString(36)}${(h1 >>> 0).toString(36)}`;
}

export function safeDocId(prefix: string, key: string): string {
  const safePrefix = prefix.replace(/[^A-Za-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 24) || "doc";
  const preview = key
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48) || "key";
  return `${safePrefix}_${stableHash(key)}_${preview}`.slice(0, 120);
}

export function createCloudSettings(appData: AppData, updatedBy: string, now = new Date().toISOString()): CloudSettings {
  return {
    schemaVersion: CLOUD_HOUSEHOLD_SCHEMA_VERSION,
    targetSaveRate: appData.settings.targetSaveRate,
    currency: appData.settings.currency,
    locale: appData.settings.locale,
    fxRates: appData.settings.fxRates,
    updatedAt: now,
    updatedBy,
  };
}

export function appDataToCloudCollections(appData: AppData, updatedBy: string, now = new Date().toISOString()): CloudCollections {
  const merchantRules: CloudMerchantRule[] = Object.entries(appData.merchantRules).map(([key, rule]) => ({
    key,
    rule,
    updatedAt: now,
    updatedBy,
  }));
  const csvPresets: CloudCsvPreset[] = Object.entries(appData.settings.csvPresets).map(([signature, mapping]) => ({
    signature,
    mapping,
    updatedAt: now,
    updatedBy,
  }));

  return {
    settings: createCloudSettings(appData, updatedBy, now),
    transactions: appData.transactions,
    accounts: appData.accounts,
    fixedCosts: appData.fixedCosts,
    incomeReceipts: appData.incomeReceipts,
    members: appData.settings.members,
    customCategories: appData.settings.customCategories,
    counterparties: appData.settings.counterparties,
    merchantRules,
    csvPresets,
  };
}

export function cloudCollectionsToAppData(collections: Partial<CloudCollections>): AppData {
  const merchantRules = Object.fromEntries((collections.merchantRules ?? []).map((item) => [item.key, item.rule]));
  const csvPresets = Object.fromEntries((collections.csvPresets ?? []).map((item) => [item.signature, item.mapping]));
  return migrate({
    transactions: collections.transactions ?? [],
    merchantRules,
    accounts: collections.accounts ?? [],
    fixedCosts: collections.fixedCosts ?? [],
    incomeReceipts: collections.incomeReceipts ?? [],
    settings: {
      members: collections.members ?? [],
      targetSaveRate: collections.settings?.targetSaveRate ?? 25,
      currency: collections.settings?.currency ?? "",
      locale: collections.settings?.locale ?? "",
      fxRates: collections.settings?.fxRates ?? {},
      csvPresets,
      counterparties: collections.counterparties ?? [],
      customCategories: collections.customCategories ?? [],
    },
  });
}

export function createLegacyCloudHousehold(appData: AppData, updatedBy: string, now = new Date().toISOString()): CloudHousehold {
  return {
    schemaVersion: 1,
    appData,
    updatedAt: now,
    updatedBy,
  };
}
