import { useEffect, useMemo, useRef, useState } from "react";
import { Trash2 } from "lucide-react";
import {
  DEFAULT_SETTINGS_TARGET,
  type SettingsTab,
  type SettingsTarget,
} from "../app/settingsTarget";
import { syncBadgeLabel, syncBadgeTone, type SyncState } from "../app/syncState";
import type { AuthState } from "../auth/authStore";
import type { Account, AppData, AssetHolding, Counterparty, CustomCategory, FixedCost, Member, MerchantRule } from "../domain/types";
import type { HouseholdMeta, UserHouseholdLink } from "../household/types";
import type { RepositoryMode } from "../storage/repository";
import { uid } from "../domain/types";
import { Button, ConfirmDialog, IconButton, Modal, StatusBadge, Tabs } from "./bits";
import { AccountRuleSettings } from "./settings/AccountRuleSettings";
import { AssetSettings } from "./settings/AssetSettings";
import { BudgetSettings } from "./settings/BudgetSettings";
import { HouseholdSettings } from "./settings/HouseholdSettings";

export interface SyncSettingsState {
  auth: AuthState;
  mode: RepositoryMode;
  status: SyncState;
  household: HouseholdMeta | null;
  households: UserHouseholdLink[];
}

const SETTINGS_TABS: { id: SettingsTab; label: string }[] = [
  { id: "household", label: "Household" },
  { id: "budget", label: "Budget" },
  { id: "assets", label: "Assets & investments" },
  { id: "categories", label: "Categories & people" },
  { id: "accounts", label: "Accounts & rules" },
  { id: "sync", label: "Sync & backup" },
];

type SettingsModalProps = {
  data: AppData;
  target?: SettingsTarget;
  onUpdateMembers: (members: Member[]) => void;
  onUpdateTarget: (targetSaveRate: number) => void;
  onUpdateCurrency: (currency: string, locale: string) => void;
  onUpdateFxRates: (fxRates: Record<string, number>) => void;
  onUpdateFixedCosts: (fixedCosts: FixedCost[]) => void;
  onUpdateAssetHoldings?: (assetHoldings: AssetHolding[]) => void;
  onUpdateAccounts: (accounts: Account[]) => void;
  onUpsertRule: (merchant: string, rule: MerchantRule) => void;
  onDeleteRules: (merchants: string[]) => void;
  onUpdateCounterparties: (counterparties: Counterparty[]) => void;
  onUpdateCustomCategories: (customCategories: CustomCategory[]) => void;
  sync: SyncSettingsState;
  onSignIn: () => void;
  onSignOut: () => void;
  onCreateHousehold: () => void;
  onJoinHousehold: () => void;
  onSwitchHousehold: (householdId: string) => void;
  onRotateInvite: () => void;
  onLinkAccessMember?: (uid: string, memberId: string) => Promise<void>;
  onPromoteOwner?: (uid: string, makePrimary?: boolean) => Promise<void>;
  onRevokeAccess?: (uid: string) => Promise<void>;
  onLeaveHousehold?: () => Promise<void>;
  onExport: () => void;
  onImportBackup: (file: File) => void;
  hasLegacyBrowserData: boolean;
  onClearData: () => void;
  canClearTransactions: boolean;
  hasTransactions: boolean;
  onClearTransactions: () => void;
  canResetHousehold: boolean;
  hasResettableData: boolean;
  onResetHousehold: () => void;
  onClose: () => void;
};

function useSettingsModel({
  data,
  target = DEFAULT_SETTINGS_TARGET,
  onUpdateMembers,
  onUpdateTarget,
  onUpdateCurrency,
  onUpdateFxRates,
  onUpdateFixedCosts,
  onUpdateAssetHoldings = () => undefined,
  onUpdateAccounts,
  onUpsertRule,
  onDeleteRules,
  onUpdateCounterparties,
  onUpdateCustomCategories,
  sync,
  onSignIn,
  onSignOut,
  onCreateHousehold,
  onJoinHousehold,
  onSwitchHousehold,
  onRotateInvite,
  onLinkAccessMember = async () => undefined,
  onPromoteOwner = async () => undefined,
  onRevokeAccess = async () => undefined,
  onLeaveHousehold = async () => undefined,
  onExport,
  onImportBackup,
  hasLegacyBrowserData,
  onClearData,
  canClearTransactions,
  hasTransactions,
  onClearTransactions,
  canResetHousehold,
  hasResettableData,
  onResetHousehold,
  onClose,
}: SettingsModalProps) {
  const importRef = useRef<HTMLInputElement>(null);
  const [activeTab, setActiveTab] = useState<SettingsTab>(target.tab);
  const [pendingDelete, setPendingDelete] = useState<null | {
    title: string;
    body: string;
    confirmLabel: string;
    action: () => void;
  }>(null);
  const { counterparties, customCategories } = data.settings;
  const fixedCosts = data.fixedCosts;
  const assetHoldings = data.assetHoldings;
  const assetFeatureActive = assetHoldings.length > 0
    || data.transactions.some((transaction) =>
      transaction.kind === "investment_transfer" || Boolean(transaction.holdingId))
    || fixedCosts.some((fixed) =>
      fixed.kind === "investment_transfer" || Boolean(fixed.holdingId));
  const [assetsActivated, setAssetsActivated] = useState(
    () => assetFeatureActive || target.tab === "assets",
  );
  const assetsAvailable = assetFeatureActive || assetsActivated;
  const visibleTabs = useMemo(
    () => SETTINGS_TABS.filter((tab) =>
      tab.id !== "assets"
      || assetsAvailable),
    [assetsAvailable],
  );

  useEffect(() => {
    if (assetFeatureActive || target.tab === "assets") setAssetsActivated(true);
  }, [assetFeatureActive, target.tab]);

  useEffect(() => {
    setActiveTab(target.tab);
  }, [target.tab, target.section, target.itemId]);

  useEffect(() => {
    const focusTarget = target.itemId
      ? document.getElementById(`settings-item-${target.itemId}`)
      : target.section
        ? document.getElementById(`settings-section-${target.section}`)
        : null;
    if (!focusTarget) return;
    focusTarget.scrollIntoView?.({ block: "center" });
    const focusable = focusTarget.matches("button, input, select, textarea, [tabindex]")
      ? focusTarget
      : focusTarget.querySelector<HTMLElement>("button, input, select, textarea, [tabindex]");
    focusable?.focus({ preventScroll: true });
  }, [activeTab, target.itemId, target.section]);

  const patchCounterparty = (id: string, name: string) =>
    onUpdateCounterparties(counterparties.map((item) => (item.id === id ? { ...item, name } : item)));
  const patchCustom = (id: string, patch: Partial<CustomCategory>) =>
    onUpdateCustomCategories(customCategories.map((item) => (item.id === id ? { ...item, ...patch } : item)));

  const requestDelete = (title: string, body: string, confirmLabel: string, action: () => void) =>
    setPendingDelete({ title, body, confirmLabel, action });
  const openTab = (tab: SettingsTab) => {
    if (tab === "assets") setAssetsActivated(true);
    setActiveTab(tab);
  };
  return {
    data, target, visibleTabs, assetFeatureActive: assetsAvailable,
    onUpdateMembers, onUpdateTarget, onUpdateCurrency, onUpdateFxRates,
    onUpdateFixedCosts, onUpdateAssetHoldings, onUpdateAccounts, onUpsertRule, onDeleteRules, onUpdateCounterparties,
    onUpdateCustomCategories, sync, onSignIn, onSignOut, onCreateHousehold,
    onJoinHousehold, onSwitchHousehold, onRotateInvite, onLinkAccessMember, onPromoteOwner,
    onRevokeAccess, onLeaveHousehold, onExport, onImportBackup,
    hasLegacyBrowserData, onClearData, canClearTransactions, hasTransactions,
    onClearTransactions, canResetHousehold, hasResettableData, onResetHousehold, onClose,
    importRef, activeTab, openTab, pendingDelete, setPendingDelete,
    counterparties, customCategories,
    patchCounterparty, patchCustom, requestDelete,
  };
}

type SettingsModel = ReturnType<typeof useSettingsModel>;

function CategoryPeopleSettings({ model }: { model: SettingsModel }) {
  const {
    activeTab, counterparties, patchCounterparty, onUpdateCounterparties, customCategories,
    patchCustom, onUpdateCustomCategories, requestDelete,
  } = model;
  return (
    <>
      {activeTab === "categories" && (
        <>
          <div className="settings-section" id="settings-panel-categories" role="tabpanel" aria-labelledby="settings-tab-categories">
            <div className="section-title" id="settings-section-categories">
              <div>
                <h3>Custom categories</h3>
                <p className="muted">Your own spending buckets, on top of the built-in ones. Deleting one makes its transactions Uncategorized.</p>
              </div>
              <Button
                variant="secondary"
                onClick={() => onUpdateCustomCategories([...customCategories, { id: uid("cat"), label: "New category", color: "#7b8194" }])}
              >
                Add category
              </Button>
            </div>
            <div className="settings-list">
              {customCategories.map((cat) => (
                <div className="member-row" key={cat.id}>
                  <input aria-label={`${cat.label || "Category"} name`} value={cat.label} onChange={(event) => patchCustom(cat.id, { label: event.target.value })} />
                  <input aria-label={`${cat.label || "Category"} colour`} type="color" value={cat.color} onChange={(event) => patchCustom(cat.id, { color: event.target.value })} />
                  <IconButton
                    label={`Delete ${cat.label || "category"}`}
                    icon={Trash2}
                    danger
                    onClick={() => requestDelete(
                      "Delete category?",
                      `Transactions using ${cat.label || "this category"} will become Uncategorized.`,
                      "Delete category",
                      () => onUpdateCustomCategories(customCategories.filter((item) => item.id !== cat.id)),
                    )}
                  />
                </div>
              ))}
              {!customCategories.length && <p className="muted">No custom categories yet.</p>}
            </div>
          </div>

          <div className="settings-section" id="settings-section-people">
            <div className="section-title">
              <div>
                <h3>People</h3>
                <p className="muted">Friends or others you lend to, get repaid by, or give handouts to. Used to tag those movements.</p>
              </div>
              <Button
                variant="secondary"
                onClick={() => onUpdateCounterparties([...counterparties, { id: uid("cp"), name: "New person" }])}
              >
                Add person
              </Button>
            </div>
            <div className="settings-list">
              {counterparties.map((cp) => (
                <div className="member-row" key={cp.id}>
                  <input aria-label={`${cp.name || "Person"} name`} value={cp.name} onChange={(event) => patchCounterparty(cp.id, event.target.value)} />
                  <IconButton
                    label={`Delete ${cp.name || "person"}`}
                    icon={Trash2}
                    danger
                    onClick={() => requestDelete(
                      "Delete person?",
                      `${cp.name || "This person"} will no longer be available for lending, repayment, or gift classifications.`,
                      "Delete person",
                      () => onUpdateCounterparties(counterparties.filter((item) => item.id !== cp.id)),
                    )}
                  />
                </div>
              ))}
              {!counterparties.length && <p className="muted">No people yet.</p>}
            </div>
          </div>
        </>
      )}

    </>
  );
}

function SyncBackupSettings({ model }: { model: SettingsModel }) {
  const {
    activeTab, sync, onSignOut, onSignIn, onCreateHousehold, onJoinHousehold,
    onRotateInvite, onSwitchHousehold, onExport, importRef, hasLegacyBrowserData,
    requestDelete, onClearData, canClearTransactions, hasTransactions, onClearTransactions,
    canResetHousehold, hasResettableData, onResetHousehold, onImportBackup,
    onLinkAccessMember, onPromoteOwner, onRevokeAccess, onLeaveHousehold, data,
  } = model;
  const currentUid = sync.auth.status === "signed-in" ? sync.auth.user.uid : "";
  const currentAccess = sync.household?.membersByUid[currentUid];
  const canManageAccess = currentAccess?.role === "owner";
  return (
    <>
      {activeTab === "sync" && (
        <>
          <div className="settings-section sync-section" id="settings-panel-sync" role="tabpanel" aria-labelledby="settings-tab-sync">
            <div id="settings-section-access">
            <h3>Google sign-in & cloud storage</h3>
            <p className="muted">
              Google sign-in identifies who is using Mizan. Financial data is stored in the active cloud household.
              Bank files and passwords are never uploaded.
            </p>
            <div className="sync-card">
              <div>
                <span className="soft-label">Account</span>
                <strong>
                  {sync.auth.status === "signed-in"
                    ? sync.auth.user.displayName
                    : sync.auth.status === "unconfigured"
                      ? "Firebase not configured"
                      : "Signed out"}
                </strong>
                <small>{sync.auth.status === "signed-in" ? sync.auth.user.email : sync.auth.error || sync.status.message}</small>
              </div>
              <div className="sync-actions">
                {sync.auth.status === "signed-in" ? (
                  <Button variant="secondary" onClick={onSignOut}>Sign out</Button>
                ) : (
                  <Button variant="primary" disabled={sync.auth.status === "unconfigured"} onClick={onSignIn}>Sign in with Google</Button>
                )}
              </div>
            </div>

            <div className="sync-card">
              <div>
                <span className="soft-label">Storage</span>
                <strong>{sync.mode === "cloud" ? sync.household?.name ?? "Household" : "No household selected"}</strong>
                <small>{sync.status.message}</small>
              </div>
            </div>

            {sync.auth.status === "signed-in" && (
              <>
                <div className="sync-actions sync-main-actions">
                  <Button variant="primary" onClick={onCreateHousehold}>Create household</Button>
                  <Button variant="secondary" onClick={onJoinHousehold}>Join with invite</Button>
                </div>
                {sync.household && (
                  <div className="invite-box">
                    <span className="soft-label">Invite code</span>
                    <code>{sync.household.inviteCode}</code>
                    {canManageAccess && <Button variant="secondary" onClick={onRotateInvite}>Rotate invite code</Button>}
                  </div>
                )}
                {sync.household && (
                  <div className="access-list" aria-label="Household app access">
                    <div>
                      <h4>App access and recovery owners</h4>
                      <p className="muted">Access is separate from financial participation. Keep a second owner so the household is not stranded.</p>
                    </div>
                    {Object.entries(sync.household.membersByUid).map(([uidValue, access]) => (
                      <div className="access-row" key={uidValue}>
                        <div>
                          <strong>{access.displayName || access.email}</strong>
                          <small>{access.email} · {access.role}{uidValue === sync.household?.ownerUid ? " · primary" : ""}</small>
                        </div>
                        <select
                          aria-label={`Budget member for ${access.displayName || access.email}`}
                          value={access.memberId ?? ""}
                          disabled={!canManageAccess}
                          onChange={(event) => void onLinkAccessMember(uidValue, event.target.value)}
                        >
                          <option value="">Not linked</option>
                          {data.settings.members.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}
                        </select>
                        {canManageAccess && access.role !== "owner" && (
                          <Button variant="secondary" onClick={() => void onPromoteOwner(uidValue)}>Make recovery owner</Button>
                        )}
                        {canManageAccess && access.role === "owner" && uidValue !== sync.household?.ownerUid && (
                          <Button variant="secondary" onClick={() => void onPromoteOwner(uidValue, true)}>Make primary</Button>
                        )}
                        {canManageAccess && uidValue !== sync.household?.ownerUid && uidValue !== currentUid && (
                          <Button variant="danger" onClick={() => requestDelete(
                            "Revoke household access?",
                            `${access.displayName || access.email} will immediately lose Firestore access. Financial history is preserved and the invite code will rotate.`,
                            "Revoke access",
                            () => { void onRevokeAccess(uidValue); },
                          )}>Revoke</Button>
                        )}
                      </div>
                    ))}
                    {Object.values(sync.household.membersByUid).filter((access) => access.role === "owner").length < 2 && (
                      <div className="reset-warning">Add a recovery owner. A sole owner who becomes unavailable cannot be replaced safely from the client.</div>
                    )}
                    {currentUid !== sync.household.ownerUid ? (
                      <Button variant="danger" onClick={() => requestDelete(
                        "Leave household access?",
                        "You will lose access, but budget members and financial history will not be changed.",
                        "Leave household",
                        () => { void onLeaveHousehold(); },
                      )}>Leave household</Button>
                    ) : (
                      <small className="muted">Transfer primary ownership before leaving this household.</small>
                    )}
                  </div>
                )}
                {sync.households.length > 0 && (
                  <label className="field">
                    <span>Switch household</span>
                    <select value={sync.household?.id ?? ""} onChange={(event) => onSwitchHousehold(event.target.value)}>
                      <option value="" disabled>Choose household</option>
                      {sync.households.map((household) => (
                        <option key={household.householdId} value={household.householdId}>
                          {household.name} ({household.role})
                        </option>
                      ))}
                    </select>
                  </label>
                )}
              </>
            )}
            </div>
          </div>

          <div className="settings-section danger-zone" id="settings-section-backup">
            <div>
              <h3>Backup & danger area</h3>
              <p className="muted">Encrypted export is the recovery copy before destructive changes. Import replaces the active Firestore household data.</p>
            </div>
            <div className="modal-actions">
              <Button variant="secondary" onClick={onExport}>Export encrypted backup</Button>
              <Button variant="secondary" onClick={() => importRef.current?.click()}>Import backup</Button>
              {hasLegacyBrowserData && (
                <Button
                  variant="danger"
                  onClick={() => requestDelete(
                    "Remove old browser copy?",
                    "Only legacy financial data stored in this browser will be removed. The active Firestore household will not be changed.",
                    "Remove browser copy",
                    onClearData,
                  )}
                >
                  Remove old browser copy
                </Button>
              )}
              {canClearTransactions && hasTransactions && (
                <Button variant="danger" onClick={onClearTransactions}>Clear transactions</Button>
              )}
              {canResetHousehold && hasResettableData && (
                <Button variant="danger" onClick={onResetHousehold}>Reset household data</Button>
              )}
              <input
                ref={importRef}
                hidden
                type="file"
                accept=".mizan,.json,application/json"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) onImportBackup(file);
                }}
              />
            </div>
          </div>
        </>
      )}
    </>
  );
}

function SettingsBody({ model }: { model: SettingsModel }) {
  const {
    sync, onClose, activeTab, openTab, pendingDelete, setPendingDelete, visibleTabs,
  } = model;
  return (
    <Modal
      title="Settings"
      onClose={onClose}
      wide
      meta={
        <span className="settings-save-status">
          <StatusBadge tone={syncBadgeTone(sync.status)}>
            {syncBadgeLabel(sync.status)}
          </StatusBadge>
          <span>Simple changes autosave; editors use Save</span>
        </span>
      }
    >
      <div className="settings-layout">
      <aside className="settings-navigation">
      <label className="settings-mobile-select">
        <span>Settings section</span>
        <select value={activeTab} onChange={(event) => openTab(event.target.value as SettingsTab)}>
          {visibleTabs.map((tab) => <option value={tab.id} key={tab.id}>{tab.label}</option>)}
        </select>
      </label>
      <Tabs
        idPrefix="settings"
        label="Settings sections"
        orientation="vertical"
        className="settings-tabs"
        value={activeTab}
        items={visibleTabs.map((tab) => ({
          id: tab.id,
          label: tab.label,
          panelId: `settings-panel-${tab.id}`,
        }))}
        onChange={openTab}
      />
      </aside>
      <div className="settings-content">

      <HouseholdSettings
        active={activeTab === "household"}
        data={model.data}
        target={model.target}
        onUpdateMembers={model.onUpdateMembers}
        onUpdateAccounts={model.onUpdateAccounts}
        requestConfirmation={model.requestDelete}
      />

      <BudgetSettings
        active={activeTab === "budget"}
        data={model.data}
        target={model.target}
        assetFeatureActive={model.assetFeatureActive}
        onUpdateTarget={model.onUpdateTarget}
        onUpdateCurrency={model.onUpdateCurrency}
        onUpdateFxRates={model.onUpdateFxRates}
        onUpdateFixedCosts={model.onUpdateFixedCosts}
        onOpenTab={openTab}
        requestConfirmation={model.requestDelete}
      />

      <AssetSettings
        active={activeTab === "assets"}
        data={model.data}
        target={model.target}
        onUpdateAssetHoldings={model.onUpdateAssetHoldings}
        requestConfirmation={model.requestDelete}
      />

      <CategoryPeopleSettings model={model} />

      <AccountRuleSettings
        active={activeTab === "accounts"}
        data={model.data}
        target={model.target}
        currentUserUid={model.sync.auth.status === "signed-in" ? model.sync.auth.user.uid : undefined}
        onUpdateAccounts={model.onUpdateAccounts}
        onUpsertRule={model.onUpsertRule}
        onDeleteRules={model.onDeleteRules}
        requestConfirmation={model.requestDelete}
      />

      <SyncBackupSettings model={model} />

      </div>
      </div>
      {pendingDelete && (
        <ConfirmDialog
          title={pendingDelete.title}
          confirmLabel={pendingDelete.confirmLabel}
          onClose={() => setPendingDelete(null)}
          onConfirm={() => {
            pendingDelete.action();
            setPendingDelete(null);
          }}
        >
          <p>{pendingDelete.body}</p>
        </ConfirmDialog>
      )}
    </Modal>
  );
}

export function SettingsModal(props: SettingsModalProps) {
  return <SettingsBody model={useSettingsModel(props)} />;
}
