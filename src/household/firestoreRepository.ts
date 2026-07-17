import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
  type DocumentData,
  type Firestore,
  type WriteBatch,
} from "firebase/firestore";
import type { AuthUser } from "../auth/authStore";
import type { Account, AppData, Counterparty, CustomCategory, EfficiencyPlan, FixedCost, IncomeReceipt, Member, SharedContribution, Transaction } from "../domain/types";
import type { DataRepository, RepositorySubscriptionOptions } from "../storage/repository";
import {
  appDataToCloudCollections,
  cloudCollectionsToAppData,
  createCloudSnapshotManifest,
  createHouseholdMeta,
  householdIdFromInvite,
  makeInviteCode,
  safeDocId,
} from "./households";
import type {
  CloudCsvPreset,
  CloudMerchantRule,
  CloudSnapshotManifest,
  CloudSettings,
  HouseholdMeta,
  UserHouseholdLink,
  UserProfile,
} from "./types";
import { loadLegacyManifestlessHousehold } from "./legacyManifestlessFirestoreAdapter";

const META_DOC = "current";
const SETTINGS_DOC = "current";
const SNAPSHOT_MANIFEST_DOC = "current";
const PROFILE_DOC = "current";
const ORDER_FIELD = "__order";
const BATCH_LIMIT = 450;

type BatchJob = (batch: WriteBatch) => void;

function metaRef(db: Firestore, householdId: string) {
  return doc(db, "households", householdId, "meta", META_DOC);
}

function joinRequestRef(db: Firestore, householdId: string, uid: string) {
  return doc(db, "households", householdId, "joinRequests", uid);
}

function settingsRef(db: Firestore, householdId: string) {
  return doc(db, "households", householdId, "settings", SETTINGS_DOC);
}

function snapshotManifestRef(db: Firestore, householdId: string) {
  return doc(db, "households", householdId, "snapshotManifest", SNAPSHOT_MANIFEST_DOC);
}

function snapshotRef(db: Firestore, householdId: string, revision: string) {
  return doc(db, "households", householdId, "snapshots", revision);
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

function snapshotCollection(db: Firestore, householdId: string, revision: string, name: string) {
  return collection(db, "households", householdId, "snapshots", revision, name);
}

function makeRevision(): string {
  const random = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID().replace(/-/g, "")
    : `${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
  return `rev_${random.slice(0, 24)}`;
}

function manifestVersion(manifest: Partial<CloudSnapshotManifest>): string {
  return typeof manifest.versionToken === "string" && manifest.versionToken
    ? manifest.versionToken
    : `${manifest.activeRevision ?? ""}|${manifest.updatedAt ?? ""}`;
}

function cleanForFirestore(value: unknown): DocumentData {
  return JSON.parse(JSON.stringify(value)) as DocumentData;
}

function sameDocument(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function withoutWriteMetadata(value: DocumentData): DocumentData {
  const { updatedAt: _updatedAt, updatedBy: _updatedBy, ...rest } = value;
  return rest;
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
    categoryFilter: "all",
    beneficiaryFilter: "all",
    payerFilter: "all",
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
    categoryFilter: typeof raw.categoryFilter === "string" ? raw.categoryFilter : "all",
    // The old ownerFilter mixed account ownership with personal-category
    // membership. It has no honest v12 equivalent, so start both explicit
    // dimensions unfiltered when the new fields are absent.
    beneficiaryFilter: typeof raw.beneficiaryFilter === "string" ? raw.beneficiaryFilter : "all",
    payerFilter: typeof raw.payerFilter === "string" ? raw.payerFilter : "all",
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

type FirestoreCollectionRef = ReturnType<typeof collection>;

async function orderedCollection<T>(ref: FirestoreCollectionRef): Promise<T[]> {
  const snapshot = await getDocs(ref);
  return snapshot.docs
    .map((item) => ({ order: Number(item.data()[ORDER_FIELD] ?? 0), data: stripOrder<T>(item.data()) }))
    .sort((a, b) => a.order - b.order)
    .map((item) => item.data);
}

async function keyedCollection<T>(ref: FirestoreCollectionRef): Promise<T[]> {
  const snapshot = await getDocs(ref);
  return snapshot.docs.map((item) => item.data() as T);
}

async function replaceOrderedCollectionJobs<T>(
  ref: FirestoreCollectionRef,
  items: T[],
  idOf: (item: T) => string,
): Promise<BatchJob[]> {
  const existing = await getDocs(ref);
  const existingById = new Map(existing.docs.map((item) => [item.id, item.data()]));
  const nextIds = new Set(items.map(idOf));
  const jobs: BatchJob[] = existing.docs
    .filter((item) => !nextIds.has(item.id))
    .map((item) => (batch) => batch.delete(item.ref));

  items.forEach((item, order) => {
    const id = idOf(item);
    const next = cleanForFirestore({ ...item, [ORDER_FIELD]: order });
    const current = existingById.get(id);
    if (!current || !sameDocument(current, next)) jobs.push((batch) => batch.set(doc(ref, id), next));
  });
  return jobs;
}

async function replaceKeyedCollectionJobs<T>(
  ref: FirestoreCollectionRef,
  items: T[],
  idOf: (item: T) => string,
): Promise<BatchJob[]> {
  const existing = await getDocs(ref);
  const existingById = new Map(existing.docs.map((item) => [item.id, item.data()]));
  const nextIds = new Set(items.map(idOf));
  const jobs: BatchJob[] = existing.docs
    .filter((item) => !nextIds.has(item.id))
    .map((item) => (batch) => batch.delete(item.ref));

  for (const item of items) {
    const id = idOf(item);
    const next = cleanForFirestore(item);
    const current = existingById.get(id);
    if (!current || !sameDocument(withoutWriteMetadata(current), withoutWriteMetadata(next))) {
      jobs.push((batch) => batch.set(doc(ref, id), next));
    }
  }
  return jobs;
}

function appendOrderedCollectionJobs<T>(
  ref: FirestoreCollectionRef,
  items: T[],
  idOf: (item: T) => string,
): BatchJob[] {
  return items.map((item, order) => (batch) => batch.set(
    doc(ref, idOf(item)),
    cleanForFirestore({ ...item, [ORDER_FIELD]: order }),
  ));
}

function appendKeyedCollectionJobs<T>(
  ref: FirestoreCollectionRef,
  items: T[],
  idOf: (item: T) => string,
): BatchJob[] {
  return items.map((item) => (batch) => batch.set(doc(ref, idOf(item)), cleanForFirestore(item)));
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
  const now = new Date().toISOString();
  try {
    await commitJobs(db, [
      (batch) => batch.set(joinRequestRef(db, householdId, user.uid), {
        uid: user.uid,
        inviteCode: inviteCode.trim(),
        createdAt: serverTimestamp(),
      }),
      (batch) => batch.update(metaRef(db, householdId), {
        [`membersByUid.${user.uid}`]: {
          role: "member",
          displayName: user.displayName,
          email: user.email,
          joinedAt: now,
        },
        updatedAt: now,
      }),
    ]);
  } catch (joinError) {
    try {
      const existing = await loadHouseholdMeta(db, householdId);
      if (!existing.membersByUid[user.uid]) throw joinError;
    } catch {
      throw new Error("Invite code does not match an accessible household.");
    }
  }

  const nextMeta = await loadHouseholdMeta(db, householdId);
  await setDoc(userHouseholdRef(db, user.uid, householdId), cleanForFirestore(linkFromMeta(nextMeta, user.uid)));
  await deleteDoc(joinRequestRef(db, householdId, user.uid)).catch(() => undefined);
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
  private activeRevision = "";
  private loadedManifestVersion = "";

  constructor(
    private readonly db: Firestore,
    private readonly householdId: string,
    private readonly uid: string,
  ) {}

  private async loadCollections(
    settings: CloudSettings,
    collectionFor: (name: string) => FirestoreCollectionRef,
  ): Promise<AppData> {
    const [
      transactions,
      sharedContributions,
      accounts,
      fixedCosts,
      incomeReceipts,
      efficiencyPlans,
      members,
      customCategories,
      counterparties,
      merchantRules,
      csvPresets,
    ] = await Promise.all([
      orderedCollection<Transaction>(collectionFor("transactions")),
      orderedCollection<SharedContribution>(collectionFor("sharedContributions")),
      orderedCollection<Account>(collectionFor("accounts")),
      orderedCollection<FixedCost>(collectionFor("fixedCosts")),
      orderedCollection<IncomeReceipt>(collectionFor("incomeReceipts")),
      orderedCollection<EfficiencyPlan>(collectionFor("efficiencyPlans")),
      orderedCollection<Member>(collectionFor("members")),
      orderedCollection<CustomCategory>(collectionFor("customCategories")),
      orderedCollection<Counterparty>(collectionFor("counterparties")),
      keyedCollection<CloudMerchantRule>(collectionFor("merchantRules")),
      keyedCollection<CloudCsvPreset>(collectionFor("csvPresets")),
    ]);
    return cloudCollectionsToAppData({
      settings,
      transactions,
      sharedContributions,
      accounts,
      fixedCosts,
      incomeReceipts,
      efficiencyPlans,
      members,
      customCategories,
      counterparties,
      merchantRules,
      csvPresets,
    });
  }

  async load(): Promise<AppData> {
    const manifestSnapshot = await getDoc(snapshotManifestRef(this.db, this.householdId));
    if (manifestSnapshot.exists()) {
      const manifest = manifestSnapshot.data() as Partial<CloudSnapshotManifest>;
      if (manifest.schemaVersion !== 1 || typeof manifest.activeRevision !== "string" || !manifest.activeRevision) {
        throw new Error("This household snapshot manifest is not readable.");
      }
      const revisionSnapshot = await getDoc(snapshotRef(this.db, this.householdId, manifest.activeRevision));
      if (!revisionSnapshot.exists()) throw new Error("The active household snapshot is incomplete.");
      const cloudSettings = revisionSnapshot.data() as CloudSettings;
      this.activeRevision = manifest.activeRevision;
      this.loadedManifestVersion = manifestVersion(manifest);
      return this.loadCollections(
        cloudSettings,
        (name) => snapshotCollection(this.db, this.householdId, manifest.activeRevision!, name),
      );
    }

    this.activeRevision = "";
    this.loadedManifestVersion = "";
    return loadLegacyManifestlessHousehold(
      async () => {
        const settings = await getDoc(settingsRef(this.db, this.householdId));
        return settings.exists() ? settings.data() as CloudSettings : null;
      },
      (cloudSettings) => this.loadCollections(
        cloudSettings,
        (name) => householdCollection(this.db, this.householdId, name),
      ),
    );
  }

  async save(data: AppData): Promise<void> {
    const now = new Date().toISOString();
    const cloud = appDataToCloudCollections(data, this.uid, now);
    const commitAgainstLoadedManifest = async (applyWrites: (transaction: Parameters<Parameters<typeof runTransaction>[1]>[0]) => void) => {
      const expectedRevision = this.activeRevision;
      const expectedVersion = this.loadedManifestVersion;
      await runTransaction(this.db, async (transaction) => {
        const currentSnapshot = await transaction.get(snapshotManifestRef(this.db, this.householdId));
        const current = currentSnapshot.exists() ? currentSnapshot.data() as Partial<CloudSnapshotManifest> : null;
        const unchanged = expectedRevision
          ? current?.activeRevision === expectedRevision && manifestVersion(current ?? {}) === expectedVersion
          : current === null;
        if (!unchanged) {
          throw new Error("This household changed on another device. Reload before saving your edit.");
        }
        applyWrites(transaction);
      });
    };
    const publishFullSnapshot = async () => {
      const revision = makeRevision();
      const collectionFor = (name: string) => snapshotCollection(this.db, this.householdId, revision, name);
      const jobs: BatchJob[] = [
        (batch) => batch.set(snapshotRef(this.db, this.householdId, revision), cleanForFirestore(cloud.settings)),
        ...appendOrderedCollectionJobs(collectionFor("transactions"), cloud.transactions, (item) => item.id),
        ...appendOrderedCollectionJobs(collectionFor("sharedContributions"), cloud.sharedContributions, (item) => item.id),
        ...appendOrderedCollectionJobs(collectionFor("accounts"), cloud.accounts, (item) => item.id),
        ...appendOrderedCollectionJobs(collectionFor("fixedCosts"), cloud.fixedCosts, (item) => item.id),
        ...appendOrderedCollectionJobs(collectionFor("incomeReceipts"), cloud.incomeReceipts, (item) => item.id),
        ...appendOrderedCollectionJobs(collectionFor("efficiencyPlans"), cloud.efficiencyPlans, (item) => item.id),
        ...appendOrderedCollectionJobs(collectionFor("members"), cloud.members, (item) => item.id),
        ...appendOrderedCollectionJobs(collectionFor("customCategories"), cloud.customCategories, (item) => item.id),
        ...appendOrderedCollectionJobs(collectionFor("counterparties"), cloud.counterparties, (item) => item.id),
        ...appendKeyedCollectionJobs(collectionFor("merchantRules"), cloud.merchantRules, (item) => safeDocId("rule", item.key)),
        ...appendKeyedCollectionJobs(collectionFor("csvPresets"), cloud.csvPresets, (item) => safeDocId("csv", item.signature)),
      ];
      await commitJobs(this.db, jobs);
      const manifest = createCloudSnapshotManifest(revision, makeRevision(), this.uid, now);
      await commitAgainstLoadedManifest((transaction) => {
        transaction.set(snapshotManifestRef(this.db, this.householdId), cleanForFirestore(manifest));
      });
      this.activeRevision = revision;
      this.loadedManifestVersion = manifest.versionToken;
    };

    if (!this.activeRevision) {
      await publishFullSnapshot();
      return;
    }

    const collectionFor = (name: string) => snapshotCollection(this.db, this.householdId, this.activeRevision, name);
    const groups = await Promise.all([
      replaceOrderedCollectionJobs(collectionFor("transactions"), cloud.transactions, (item) => item.id),
      replaceOrderedCollectionJobs(collectionFor("sharedContributions"), cloud.sharedContributions, (item) => item.id),
      replaceOrderedCollectionJobs(collectionFor("accounts"), cloud.accounts, (item) => item.id),
      replaceOrderedCollectionJobs(collectionFor("fixedCosts"), cloud.fixedCosts, (item) => item.id),
      replaceOrderedCollectionJobs(collectionFor("incomeReceipts"), cloud.incomeReceipts, (item) => item.id),
      replaceOrderedCollectionJobs(collectionFor("efficiencyPlans"), cloud.efficiencyPlans, (item) => item.id),
      replaceOrderedCollectionJobs(collectionFor("members"), cloud.members, (item) => item.id),
      replaceOrderedCollectionJobs(collectionFor("customCategories"), cloud.customCategories, (item) => item.id),
      replaceOrderedCollectionJobs(collectionFor("counterparties"), cloud.counterparties, (item) => item.id),
      replaceKeyedCollectionJobs(collectionFor("merchantRules"), cloud.merchantRules, (item) => safeDocId("rule", item.key)),
      replaceKeyedCollectionJobs(collectionFor("csvPresets"), cloud.csvPresets, (item) => safeDocId("csv", item.signature)),
    ]);
    const jobs = groups.flat();
    if (jobs.length + 2 > BATCH_LIMIT) {
      await publishFullSnapshot();
      return;
    }

    const manifest = createCloudSnapshotManifest(this.activeRevision, makeRevision(), this.uid, now);
    await commitAgainstLoadedManifest((transaction) => {
      for (const job of jobs) job(transaction as unknown as WriteBatch);
      transaction.set(snapshotRef(this.db, this.householdId, this.activeRevision), cleanForFirestore(cloud.settings));
      transaction.set(snapshotManifestRef(this.db, this.householdId), cleanForFirestore(manifest));
    });
    this.loadedManifestVersion = manifest.versionToken;
  }

  subscribe(
    onData: (data: AppData) => void,
    onError: (message: string) => void,
    options: RepositorySubscriptionOptions = {},
  ): () => void {
    let active = true;
    let firstSnapshot = true;
    const unsubscribe = onSnapshot(
      snapshotManifestRef(this.db, this.householdId),
      (snapshot) => {
        if (!snapshot.exists()) return;
        const matchesLoadedData = manifestVersion(snapshot.data()) === this.loadedManifestVersion;
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
