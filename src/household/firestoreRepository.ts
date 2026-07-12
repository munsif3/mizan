import {
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  setDoc,
  updateDoc,
  writeBatch,
  type DocumentData,
  type Firestore,
  type WriteBatch,
} from "firebase/firestore";
import type { AuthUser } from "../auth/authStore";
import type { Account, AppData, Counterparty, CustomCategory, FixedCost, IncomeReceipt, Member, SharedContribution, Transaction } from "../domain/types";
import { migrate } from "../storage/schema";
import type { DataRepository, RepositorySubscriptionOptions } from "../storage/repository";
import {
  appDataToCloudCollections,
  cloudCollectionsToAppData,
  createHouseholdMeta,
  householdIdFromInvite,
  makeInviteCode,
  safeDocId,
} from "./households";
import type {
  CloudCollections,
  CloudCsvPreset,
  CloudHousehold,
  CloudMerchantRule,
  CloudSettings,
  HouseholdMeta,
  UserHouseholdLink,
  UserProfile,
} from "./types";

const META_DOC = "current";
const SETTINGS_DOC = "current";
const LEGACY_DATA_DOC = "current";
const PROFILE_DOC = "current";
const ORDER_FIELD = "__order";
const BATCH_LIMIT = 450;

type BatchJob = (batch: WriteBatch) => void;

function metaRef(db: Firestore, householdId: string) {
  return doc(db, "households", householdId, "meta", META_DOC);
}

function settingsRef(db: Firestore, householdId: string) {
  return doc(db, "households", householdId, "settings", SETTINGS_DOC);
}

function legacyDataRef(db: Firestore, householdId: string) {
  return doc(db, "households", householdId, "data", LEGACY_DATA_DOC);
}

function userHouseholdRef(db: Firestore, uid: string, householdId: string) {
  return doc(db, "users", uid, "households", householdId);
}

function userProfileRef(db: Firestore, uid: string) {
  return doc(db, "users", uid, "profile", PROFILE_DOC);
}

function householdCollection(db: Firestore, householdId: string, name: string) {
  return collection(db, "households", householdId, name);
}

function cleanForFirestore(value: unknown): DocumentData {
  return JSON.parse(JSON.stringify(value)) as DocumentData;
}

function stripOrder<T>(data: DocumentData): T {
  const { [ORDER_FIELD]: _order, ...rest } = data;
  return rest as T;
}

function linkFromMeta(meta: HouseholdMeta, uid: string): UserHouseholdLink {
  return {
    householdId: meta.id,
    name: meta.name,
    role: meta.membersByUid[uid]?.role ?? "member",
    joinedAt: meta.membersByUid[uid]?.joinedAt ?? meta.createdAt,
    updatedAt: meta.updatedAt,
  };
}

function assertMeta(value: unknown): HouseholdMeta {
  const raw = value as Partial<HouseholdMeta>;
  if (!raw || typeof raw.id !== "string" || typeof raw.inviteCode !== "string" || !raw.membersByUid) {
    throw new Error("This household record is not readable.");
  }
  return raw as HouseholdMeta;
}

function emptyProfile(): UserProfile {
  return {
    activeHouseholdId: "",
    privacy: false,
    lastView: "home",
    lastMonth: "",
    ownerFilter: "all",
    categoryFilter: "all",
    lastCheckInByHousehold: {},
    updatedAt: "",
  };
}

function coerceProfile(value: unknown): UserProfile {
  const raw = (value && typeof value === "object" ? value : {}) as Partial<UserProfile>;
  const checkIns =
    raw.lastCheckInByHousehold && typeof raw.lastCheckInByHousehold === "object"
      ? Object.fromEntries(
          Object.entries(raw.lastCheckInByHousehold).filter(
            ([householdId, checkedAt]) => householdId && typeof checkedAt === "string" && Number.isFinite(Date.parse(checkedAt)),
          ),
        )
      : {};
  return {
    activeHouseholdId: typeof raw.activeHouseholdId === "string" ? raw.activeHouseholdId : "",
    privacy: raw.privacy === true,
    theme: raw.theme === "light" || raw.theme === "dark" ? raw.theme : undefined,
    lastView: typeof raw.lastView === "string" ? raw.lastView : "home",
    lastMonth: typeof raw.lastMonth === "string" ? raw.lastMonth : "",
    ownerFilter: typeof raw.ownerFilter === "string" ? raw.ownerFilter : "all",
    categoryFilter: typeof raw.categoryFilter === "string" ? raw.categoryFilter : "all",
    lastCheckInByHousehold: checkIns,
    updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : "",
  };
}

async function commitJobs(db: Firestore, jobs: BatchJob[]): Promise<void> {
  for (let index = 0; index < jobs.length; index += BATCH_LIMIT) {
    const batch = writeBatch(db);
    for (const job of jobs.slice(index, index + BATCH_LIMIT)) job(batch);
    await batch.commit();
  }
}

async function orderedCollection<T>(db: Firestore, householdId: string, name: string): Promise<T[]> {
  const snapshot = await getDocs(householdCollection(db, householdId, name));
  return snapshot.docs
    .map((item) => ({ order: Number(item.data()[ORDER_FIELD] ?? 0), data: stripOrder<T>(item.data()) }))
    .sort((a, b) => a.order - b.order)
    .map((item) => item.data);
}

async function keyedCollection<T>(db: Firestore, householdId: string, name: string): Promise<T[]> {
  const snapshot = await getDocs(householdCollection(db, householdId, name));
  return snapshot.docs.map((item) => item.data() as T);
}

async function replaceOrderedCollectionJobs<T>(
  db: Firestore,
  householdId: string,
  name: string,
  items: T[],
  idOf: (item: T) => string,
): Promise<BatchJob[]> {
  const ref = householdCollection(db, householdId, name);
  const existing = await getDocs(ref);
  const nextIds = new Set(items.map(idOf));
  const jobs: BatchJob[] = existing.docs
    .filter((item) => !nextIds.has(item.id))
    .map((item) => (batch) => batch.delete(item.ref));

  items.forEach((item, order) => {
    const id = idOf(item);
    jobs.push((batch) => batch.set(doc(ref, id), cleanForFirestore({ ...item, [ORDER_FIELD]: order })));
  });
  return jobs;
}

async function replaceKeyedCollectionJobs<T>(
  db: Firestore,
  householdId: string,
  name: string,
  items: T[],
  idOf: (item: T) => string,
): Promise<BatchJob[]> {
  const ref = householdCollection(db, householdId, name);
  const existing = await getDocs(ref);
  const nextIds = new Set(items.map(idOf));
  const jobs: BatchJob[] = existing.docs
    .filter((item) => !nextIds.has(item.id))
    .map((item) => (batch) => batch.delete(item.ref));

  for (const item of items) {
    jobs.push((batch) => batch.set(doc(ref, idOf(item)), cleanForFirestore(item)));
  }
  return jobs;
}

export async function loadUserHouseholds(db: Firestore, uid: string): Promise<UserHouseholdLink[]> {
  const snapshot = await getDocs(collection(db, "users", uid, "households"));
  return snapshot.docs
    .map((item) => item.data() as UserHouseholdLink)
    .filter((item) => typeof item.householdId === "string")
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function loadUserProfile(db: Firestore, uid: string): Promise<UserProfile> {
  const snapshot = await getDoc(userProfileRef(db, uid));
  return snapshot.exists() ? coerceProfile(snapshot.data()) : emptyProfile();
}

export async function saveUserProfile(db: Firestore, uid: string, patch: Partial<UserProfile>): Promise<void> {
  await setDoc(userProfileRef(db, uid), cleanForFirestore({ ...patch, updatedAt: new Date().toISOString() }), { merge: true });
}

export async function loadHouseholdMeta(db: Firestore, householdId: string): Promise<HouseholdMeta> {
  const snapshot = await getDoc(metaRef(db, householdId));
  if (!snapshot.exists()) throw new Error("Household not found.");
  return assertMeta(snapshot.data());
}

export async function createFirestoreHousehold(
  db: Firestore,
  owner: AuthUser,
  name: string,
  appData: AppData,
): Promise<HouseholdMeta> {
  const meta = createHouseholdMeta(owner, name);
  await commitJobs(db, [
    (batch) => batch.set(metaRef(db, meta.id), cleanForFirestore(meta)),
    (batch) => batch.set(userHouseholdRef(db, owner.uid, meta.id), cleanForFirestore(linkFromMeta(meta, owner.uid))),
  ]);
  await new FirestoreHouseholdRepository(db, meta.id, owner.uid).save(appData);
  return meta;
}

export async function joinFirestoreHousehold(db: Firestore, user: AuthUser, inviteCode: string): Promise<HouseholdMeta> {
  const householdId = householdIdFromInvite(inviteCode);
  if (!householdId) throw new Error("Invite code is not in a format Mizan recognizes.");
  const meta = await loadHouseholdMeta(db, householdId);
  if (meta.inviteCode !== inviteCode.trim()) throw new Error("Invite code does not match this household.");

  const now = new Date().toISOString();
  const nextMeta: HouseholdMeta = {
    ...meta,
    updatedAt: now,
    membersByUid: {
      ...meta.membersByUid,
      [user.uid]: {
        role: meta.ownerUid === user.uid ? "owner" : "member",
        displayName: user.displayName,
        email: user.email,
        joinedAt: meta.membersByUid[user.uid]?.joinedAt ?? now,
      },
    },
  };
  await commitJobs(db, [
    (batch) => batch.set(metaRef(db, meta.id), cleanForFirestore(nextMeta)),
    (batch) => batch.set(userHouseholdRef(db, user.uid, meta.id), cleanForFirestore(linkFromMeta(nextMeta, user.uid))),
  ]);
  return nextMeta;
}

export async function rotateFirestoreInvite(db: Firestore, householdId: string): Promise<HouseholdMeta> {
  const meta = await loadHouseholdMeta(db, householdId);
  const nextMeta = { ...meta, inviteCode: makeInviteCode(householdId), updatedAt: new Date().toISOString() };
  await updateDoc(metaRef(db, householdId), { inviteCode: nextMeta.inviteCode, updatedAt: nextMeta.updatedAt });
  return nextMeta;
}

export class FirestoreHouseholdRepository implements DataRepository {
  readonly mode = "cloud" as const;
  private loadedSettingsUpdatedAt = "";

  constructor(
    private readonly db: Firestore,
    private readonly householdId: string,
    private readonly uid: string,
  ) {}

  async load(): Promise<AppData> {
    const settings = await getDoc(settingsRef(this.db, this.householdId));
    if (!settings.exists()) {
      this.loadedSettingsUpdatedAt = "";
      const legacy = await getDoc(legacyDataRef(this.db, this.householdId));
      if (!legacy.exists()) return migrate(null);
      const cloud = legacy.data() as Partial<CloudHousehold>;
      return migrate(cloud.appData ?? null);
    }

    const cloudSettings = settings.data() as CloudSettings;
    this.loadedSettingsUpdatedAt = typeof cloudSettings.updatedAt === "string" ? cloudSettings.updatedAt : "";
    const [
      transactions,
      sharedContributions,
      accounts,
      fixedCosts,
      incomeReceipts,
      members,
      customCategories,
      counterparties,
      merchantRules,
      csvPresets,
    ] = await Promise.all([
      orderedCollection<Transaction>(this.db, this.householdId, "transactions"),
      orderedCollection<SharedContribution>(this.db, this.householdId, "sharedContributions"),
      orderedCollection<Account>(this.db, this.householdId, "accounts"),
      orderedCollection<FixedCost>(this.db, this.householdId, "fixedCosts"),
      orderedCollection<IncomeReceipt>(this.db, this.householdId, "incomeReceipts"),
      orderedCollection<Member>(this.db, this.householdId, "members"),
      orderedCollection<CustomCategory>(this.db, this.householdId, "customCategories"),
      orderedCollection<Counterparty>(this.db, this.householdId, "counterparties"),
      keyedCollection<CloudMerchantRule>(this.db, this.householdId, "merchantRules"),
      keyedCollection<CloudCsvPreset>(this.db, this.householdId, "csvPresets"),
    ]);
    const collections: CloudCollections = {
      settings: cloudSettings,
      transactions,
      sharedContributions,
      accounts,
      fixedCosts,
      incomeReceipts,
      members,
      customCategories,
      counterparties,
      merchantRules,
      csvPresets,
    };
    return cloudCollectionsToAppData(collections);
  }

  async save(data: AppData): Promise<void> {
    const now = new Date().toISOString();
    const cloud = appDataToCloudCollections(data, this.uid, now);
    const jobs: BatchJob[] = [
      (batch) => batch.set(settingsRef(this.db, this.householdId), cleanForFirestore(cloud.settings)),
      ...(await replaceOrderedCollectionJobs(this.db, this.householdId, "transactions", cloud.transactions, (item) => item.id)),
      ...(await replaceOrderedCollectionJobs(this.db, this.householdId, "sharedContributions", cloud.sharedContributions, (item) => item.id)),
      ...(await replaceOrderedCollectionJobs(this.db, this.householdId, "accounts", cloud.accounts, (item) => item.id)),
      ...(await replaceOrderedCollectionJobs(this.db, this.householdId, "fixedCosts", cloud.fixedCosts, (item) => item.id)),
      ...(await replaceOrderedCollectionJobs(this.db, this.householdId, "incomeReceipts", cloud.incomeReceipts, (item) => item.id)),
      ...(await replaceOrderedCollectionJobs(this.db, this.householdId, "members", cloud.members, (item) => item.id)),
      ...(await replaceOrderedCollectionJobs(this.db, this.householdId, "customCategories", cloud.customCategories, (item) => item.id)),
      ...(await replaceOrderedCollectionJobs(this.db, this.householdId, "counterparties", cloud.counterparties, (item) => item.id)),
      ...(await replaceKeyedCollectionJobs(this.db, this.householdId, "merchantRules", cloud.merchantRules, (item) =>
        safeDocId("rule", item.key),
      )),
      ...(await replaceKeyedCollectionJobs(this.db, this.householdId, "csvPresets", cloud.csvPresets, (item) =>
        safeDocId("csv", item.signature),
      )),
    ];
    await commitJobs(this.db, jobs);
  }

  subscribe(
    onData: (data: AppData) => void,
    onError: (message: string) => void,
    options: RepositorySubscriptionOptions = {},
  ): () => void {
    let active = true;
    let firstSnapshot = true;
    const unsubscribe = onSnapshot(
      settingsRef(this.db, this.householdId),
      (snapshot) => {
        if (!snapshot.exists()) return;
        const snapshotUpdatedAt = snapshot.data().updatedAt;
        const matchesLoadedData = snapshotUpdatedAt === this.loadedSettingsUpdatedAt;
        if (firstSnapshot && options.skipInitial && matchesLoadedData) {
          firstSnapshot = false;
          return;
        }
        firstSnapshot = false;
        this.load()
          .then((data) => active && onData(data))
          .catch((error) => active && onError((error as Error).message));
      },
      (error) => active && onError(error.message),
    );
    return () => {
      active = false;
      unsubscribe();
    };
  }
}
