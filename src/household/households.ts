import type { AuthUser } from "../auth/authStore";
import type { AppData } from "../domain/types";
import { stableHash } from "../domain/ids";
import { migrate } from "../storage/schema";
import {
  CLOUD_HOUSEHOLD_SCHEMA_VERSION,
  CLOUD_SNAPSHOT_MANIFEST_VERSION,
  type CloudCollections,
  type CloudCsvPreset,
  type CloudMerchantRule,
  type CloudSettings,
  type HouseholdMeta,
} from "./types";

function randomToken(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID().replace(/-/g, "").slice(0, 16);
  return `${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-6)}`;
}

function makeHouseholdId(): string {
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
      data.sharedContributions.length ||
      Object.keys(data.merchantRules).length ||
      data.accounts.length ||
      data.fixedCosts.length ||
      data.incomeReceipts.length ||
      data.efficiencyPlans.length ||
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

export function safeDocId(prefix: string, key: string): string {
  const safePrefix = prefix.replace(/[^A-Za-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 24) || "doc";
  const preview = key
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48) || "key";
  return `${safePrefix}_${stableHash(key)}_${preview}`.slice(0, 120);
}

function createCloudSettings(appData: AppData, updatedBy: string, now = new Date().toISOString()): CloudSettings {
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
    sharedContributions: appData.sharedContributions,
    accounts: appData.accounts,
    fixedCosts: appData.fixedCosts,
    incomeReceipts: appData.incomeReceipts,
    efficiencyPlans: appData.efficiencyPlans,
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
  const cloudSchemaVersion = Number(collections.settings?.schemaVersion) || 0;
  if (cloudSchemaVersion > CLOUD_HOUSEHOLD_SCHEMA_VERSION) {
    throw new Error(`This household uses cloud schema v${cloudSchemaVersion}. Update Mizan before opening it.`);
  }
  return migrate({
    // Split-cloud v4 stored AppData v10 semantics; v5 added beneficiaries,
    // v6 recurring-commitment payment types, v7 scheduled income sources,
    // and v8 household-shared efficiency plans.
    schemaVersion: cloudSchemaVersion >= 8 ? 15 : cloudSchemaVersion >= 7 ? 14 : cloudSchemaVersion >= 6 ? 13 : cloudSchemaVersion >= 5 ? 12 : 10,
    transactions: collections.transactions ?? [],
    sharedContributions: collections.sharedContributions ?? [],
    merchantRules,
    accounts: collections.accounts ?? [],
    fixedCosts: collections.fixedCosts ?? [],
    incomeReceipts: collections.incomeReceipts ?? [],
    efficiencyPlans: collections.efficiencyPlans ?? [],
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

export function createCloudSnapshotManifest(activeRevision: string, versionToken: string, updatedBy: string, now = new Date().toISOString()) {
  return {
    schemaVersion: CLOUD_SNAPSHOT_MANIFEST_VERSION,
    activeRevision,
    versionToken,
    updatedAt: now,
    updatedBy,
  };
}
