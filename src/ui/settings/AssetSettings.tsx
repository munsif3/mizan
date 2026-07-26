import { useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import type { SettingsTarget } from "../../app/settingsTarget";
import { ASSET_TYPE_OPTIONS } from "../../domain/assets";
import { isoDateOf } from "../../domain/dates";
import {
  uid,
  type AppData,
  type AssetHolding,
} from "../../domain/types";
import { Button, IconButton } from "../bits";
import type { RequestConfirmation } from "./shared";

export interface AssetSettingsProps {
  active: boolean;
  data: AppData;
  target: SettingsTarget;
  onUpdateAssetHoldings: (assetHoldings: AssetHolding[]) => void;
  requestConfirmation: RequestConfirmation;
}

export function AssetSettings({
  active,
  data,
  target,
  onUpdateAssetHoldings,
  requestConfirmation,
}: AssetSettingsProps) {
  const assetHoldings = data.assetHoldings;
  const members = data.settings.members;
  const currency = data.settings.currency;
  const [draft, setDraft] = useState<AssetHolding | null>(null);
  const original = draft
    ? assetHoldings.find((holding) => holding.id === draft.id)
    : undefined;
  const displayedHoldings = draft
    ? original
      ? assetHoldings.map((holding) => holding.id === draft.id ? draft : holding)
      : [...assetHoldings, draft]
    : assetHoldings;
  const patchAsset = (id: string, patch: Partial<AssetHolding>) =>
    setDraft((current) => current?.id === id ? { ...current, ...patch } : current);

  useEffect(() => {
    if (target.tab !== "assets" || !target.itemId) return;
    const focused = assetHoldings.find((holding) => holding.id === target.itemId);
    if (focused) {
      setDraft({
        ...focused,
        valuations: focused.valuations.map((valuation) => ({ ...valuation })),
      });
    }
  }, [assetHoldings, target.itemId, target.tab]);

  if (!active) return null;
  return (
    <div className="settings-section" id="settings-panel-assets" role="tabpanel" aria-labelledby="settings-tab-assets">
      <div className="section-title" id="settings-section-assets">
        <div>
          <h3>Assets & investments</h3>
          <p className="muted">
            Optional holdings stay separate from spending. Open one only when you need to update it.
          </p>
        </div>
        <Button
          variant="secondary"
          onClick={() => setDraft({
            id: uid("asset"),
            label: "",
            type: "fixed_deposit",
            currency,
            owner: members.length === 1 ? members[0]!.id : "unassigned",
            status: "active",
            valuations: [],
          })}
        >
          Add holding
        </Button>
      </div>
      {!assetHoldings.length && !draft && <p className="muted">No holdings yet.</p>}
      <div className="commitment-list asset-holding-list">
        {displayedHoldings.map((holding) => {
          const editing = draft?.id === holding.id;
          const patchValuation = (
            valuationId: string,
            patch: Partial<AssetHolding["valuations"][number]>,
          ) =>
            patchAsset(holding.id, {
              valuations: holding.valuations.map((valuation) =>
                valuation.id === valuationId ? { ...valuation, ...patch } : valuation),
            });
          return (
            <article className="fixed-cost-card" id={`settings-item-${holding.id}`} key={holding.id}>
              <header className="fixed-cost-card-header">
                <div>
                  <span className="soft-label">
                    {ASSET_TYPE_OPTIONS.find((item) => item.type === holding.type)?.label}
                  </span>
                  <strong>{holding.label || "Untitled holding"}</strong>
                  <small>
                    {holding.status} · {holding.valuations.length} valuation
                    {holding.valuations.length === 1 ? "" : "s"}
                  </small>
                </div>
                {!editing && (
                  <Button
                    variant="secondary"
                    onClick={() => setDraft({
                      ...holding,
                      valuations: holding.valuations.map((valuation) => ({ ...valuation })),
                    })}
                  >
                    Edit
                  </Button>
                )}
              </header>
              {editing && (
                <>
                  <div className="fixed-cost-grid">
                    <label className="field">
                      <span>Holding name</span>
                      <input
                        aria-label={`Holding name for ${holding.label}`}
                        value={holding.label}
                        onChange={(event) => patchAsset(holding.id, { label: event.target.value })}
                      />
                    </label>
                    <label className="field">
                      <span>Asset type</span>
                      <select
                        aria-label={`Asset type for ${holding.label}`}
                        value={holding.type}
                        onChange={(event) => patchAsset(holding.id, {
                          type: event.target.value as AssetHolding["type"],
                        })}
                      >
                        {ASSET_TYPE_OPTIONS.map((option) => (
                          <option value={option.type} key={option.type}>{option.label}</option>
                        ))}
                      </select>
                    </label>
                    {members.length > 1 && (
                      <label className="field">
                        <span>Owned by</span>
                        <select
                          aria-label={`Owner for ${holding.label}`}
                          value={holding.owner}
                          onChange={(event) => patchAsset(holding.id, {
                            owner: event.target.value as AssetHolding["owner"],
                          })}
                        >
                          <option value="unassigned">Unassigned — needs review</option>
                          <option value="joint">Joint</option>
                          {members.map((member) => (
                            <option value={member.id} key={member.id}>{member.name}</option>
                          ))}
                        </select>
                      </label>
                    )}
                    <label className="field">
                      <span>Currency</span>
                      <input
                        aria-label={`Currency for ${holding.label}`}
                        value={holding.currency || currency}
                        onChange={(event) => patchAsset(holding.id, {
                          currency: event.target.value.toUpperCase().trim(),
                        })}
                      />
                    </label>
                    <label className="field">
                      <span>Institution</span>
                      <input
                        aria-label={`Institution for ${holding.label}`}
                        value={holding.institution ?? ""}
                        onChange={(event) => patchAsset(holding.id, {
                          institution: event.target.value || undefined,
                        })}
                      />
                    </label>
                    <label className="field">
                      <span>Linked cash account</span>
                      <select
                        aria-label={`Linked account for ${holding.label}`}
                        value={holding.linkedAccountId ?? ""}
                        onChange={(event) => patchAsset(holding.id, {
                          linkedAccountId: event.target.value || undefined,
                        })}
                      >
                        <option value="">None</option>
                        {data.accounts.map((account) => (
                          <option value={account.id} key={account.id}>{account.label}</option>
                        ))}
                      </select>
                    </label>
                    <label className="field">
                      <span>Opened</span>
                      <input
                        aria-label={`Opened date for ${holding.label}`}
                        type="date"
                        value={holding.openedOn ?? ""}
                        onChange={(event) => patchAsset(holding.id, {
                          openedOn: event.target.value || undefined,
                        })}
                      />
                    </label>
                    <label className="field">
                      <span>Matures</span>
                      <input
                        aria-label={`Maturity date for ${holding.label}`}
                        type="date"
                        value={holding.maturityOn ?? ""}
                        onChange={(event) => patchAsset(holding.id, {
                          maturityOn: event.target.value || undefined,
                        })}
                      />
                    </label>
                    <label className="field">
                      <span>Status</span>
                      <select
                        aria-label={`Status for ${holding.label}`}
                        value={holding.status}
                        onChange={(event) => patchAsset(holding.id, {
                          status: event.target.value as AssetHolding["status"],
                        })}
                      >
                        <option value="active">Active</option>
                        <option value="matured">Matured</option>
                        <option value="closed">Closed</option>
                      </select>
                    </label>
                  </div>
                  <div className="asset-valuations">
                    <div className="section-title compact-title">
                      <div>
                        <strong>Valuation snapshots</strong>
                        <small>Do not infer current value from contributions.</small>
                      </div>
                      <Button
                        variant="secondary"
                        onClick={() => patchAsset(holding.id, {
                          valuations: [
                            ...holding.valuations,
                            { id: uid("value"), date: isoDateOf(new Date()), amount: 0 },
                          ],
                        })}
                      >
                        Add valuation
                      </Button>
                    </div>
                    {holding.valuations.map((valuation) => (
                      <div className="form-grid" key={valuation.id}>
                        <label className="field">
                          <span>Date</span>
                          <input
                            aria-label={`Valuation date for ${holding.label}`}
                            type="date"
                            value={valuation.date}
                            onChange={(event) => patchValuation(valuation.id, {
                              date: event.target.value,
                            })}
                          />
                        </label>
                        <label className="field">
                          <span>Value</span>
                          <input
                            aria-label={`Valuation amount for ${holding.label}`}
                            type="number"
                            min="0"
                            value={valuation.amount}
                            onChange={(event) => patchValuation(valuation.id, {
                              amount: Math.max(0, Number(event.target.value) || 0),
                            })}
                          />
                        </label>
                        <label className="field">
                          <span>Note</span>
                          <input
                            aria-label={`Valuation note for ${holding.label}`}
                            value={valuation.note ?? ""}
                            onChange={(event) => patchValuation(valuation.id, {
                              note: event.target.value || undefined,
                            })}
                          />
                        </label>
                        <IconButton
                          label={`Delete valuation for ${holding.label}`}
                          icon={Trash2}
                          danger
                          onClick={() => patchAsset(holding.id, {
                            valuations: holding.valuations.filter(
                              (item) => item.id !== valuation.id,
                            ),
                          })}
                        />
                      </div>
                    ))}
                  </div>
                  <div className="modal-actions">
                    {original && (
                      <Button
                        variant="danger"
                        onClick={() => requestConfirmation(
                          "Delete asset holding?",
                          `${original.label || "This holding"} will be removed. Linked transactions keep their statement evidence but lose the holding link.`,
                          "Delete holding",
                          () => {
                            onUpdateAssetHoldings(
                              assetHoldings.filter((item) => item.id !== original.id),
                            );
                            setDraft(null);
                          },
                        )}
                      >
                        Delete
                      </Button>
                    )}
                    <Button variant="secondary" onClick={() => setDraft(null)}>Cancel</Button>
                    <Button
                      variant="primary"
                      disabled={!holding.label.trim()}
                      onClick={() => {
                        onUpdateAssetHoldings(original
                          ? assetHoldings.map((item) => item.id === holding.id ? holding : item)
                          : [...assetHoldings, holding]);
                        setDraft(null);
                      }}
                    >
                      Save holding
                    </Button>
                  </div>
                </>
              )}
            </article>
          );
        })}
      </div>
    </div>
  );
}
