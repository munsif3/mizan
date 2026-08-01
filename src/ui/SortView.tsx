import { useEffect, useMemo, useState } from "react";
import { ArrowDown, Check, Repeat2 } from "lucide-react";
import { categoryInfo } from "../domain/categories";
import { monthLabel, monthOf } from "../domain/dates";
import { matchingKey } from "../domain/rules";
import { needsClassificationReview, netAmount, type ReviewItem } from "../domain/summary";
import type { TransferCandidate } from "../domain/transfers";
import type { Account, CategoryKey, Member, MerchantRule, Split, Transaction } from "../domain/types";
import { Button, MoneyValue } from "./bits";

type SortBeneficiary = "household" | `member:${string}`;

interface CategoryChoice {
  key: CategoryKey;
  label: string;
  color: string;
  dashed?: boolean;
}

const CATEGORY_CHOICES: CategoryChoice[] = [
  { key: "food", label: "Groceries", color: categoryInfo("food").color },
  { key: "housing", label: "Household", color: categoryInfo("housing").color },
  { key: "dining", label: "Dining out", color: categoryInfo("dining").color },
  { key: "health", label: "Health", color: categoryInfo("health").color },
  { key: "transport", label: "Transport", color: categoryInfo("transport").color },
  { key: "lifestyle", label: "Something else", color: categoryInfo("lifestyle").color, dashed: true },
];

export interface SortViewProps {
  queue: ReviewItem[];
  transferCandidates: TransferCandidate[];
  members: Member[];
  accounts?: Account[];
  allTransactions?: Transaction[];
  money: (value: number) => string;
  financialValuesHidden?: boolean;
  undoLabel: string;
  onCategorizeMerchant: (merchant: string, rule: MerchantRule) => void;
  onCategorizeMerchants: (entries: { merchant: string; rule: MerchantRule }[]) => void;
  onRememberMerchant?: (id: string) => void;
  onSaveSplit: (id: string, split: Split) => void;
  onAdjustSplit: (transaction: Transaction) => void;
  onConfirmTransfer: (debitId: string, creditId: string) => void;
  onRejectTransfer: (debitId: string, creditId: string) => void;
  onUndo: () => void;
}

interface RatioAmounts {
  mine: number;
  other: number;
}

function splitAmounts(amount: number, split: Split): RatioAmounts {
  const totalCents = Math.max(0, Math.round(amount * 100));
  const of = Math.max(1, Math.round(Number(split.of) || 1));
  const mine = Math.min(of, Math.max(0, Math.round(Number(split.mine) || 0)));
  const exactMine = totalCents * (mine / of);
  const exactOther = totalCents - exactMine;
  const mineFloor = Math.floor(exactMine);
  const otherFloor = Math.floor(exactOther);
  const remainder = totalCents - mineFloor - otherFloor;
  if (exactMine >= exactOther) {
    return { mine: (mineFloor + remainder) / 100, other: otherFloor / 100 };
  }
  return { mine: mineFloor / 100, other: (otherFloor + remainder) / 100 };
}

function categoryChoiceFor(key: CategoryKey | undefined): CategoryChoice | undefined {
  return CATEGORY_CHOICES.find((choice) => choice.key === key);
}

function merchantMatch(transaction: Transaction, merchant: string): boolean {
  return matchingKey(transaction.description, [merchant]) === merchant;
}

function dateLabel(date: string): string {
  const [year, month, day] = date.split("-").map(Number);
  if (!year || !month || !day) return date;
  return `${String(day).padStart(2, "0")} ${new Date(Date.UTC(year, month - 1, day)).toLocaleDateString(undefined, { month: "short", timeZone: "UTC" })}`;
}

function memberKeyLabels(members: Member[]): Map<string, string> {
  const grouped = new Map<string, Member[]>();
  for (const member of members) {
    const initial = member.name.trim().charAt(0).toUpperCase() || "?";
    grouped.set(initial, [...(grouped.get(initial) ?? []), member]);
  }
  return new Map(members.map((member) => {
    const initial = member.name.trim().charAt(0).toUpperCase() || "?";
    const group = grouped.get(initial) ?? [member];
    if (group.length === 1) return [member.id, initial];
    return [member.id, `${initial}${group.indexOf(member) + 1}`];
  }));
}

function ruleFor(category: CategoryKey, beneficiary: SortBeneficiary, solo: boolean): MerchantRule {
  return {
    category,
    beneficiary: solo ? { type: "account_default" } : beneficiary === "household"
      ? { type: "household" }
      : { type: "member", memberId: beneficiary.slice("member:".length) },
    kind: "expense",
  };
}

function TransferReview({
  pair,
  money,
  financialValuesHidden,
  onConfirm,
  onReject,
}: {
  pair: TransferCandidate;
  money: (value: number) => string;
  financialValuesHidden: boolean;
  onConfirm: () => void;
  onReject: () => void;
}) {
  const month = monthLabel(monthOf(pair.debit.date));
  const distance = pair.daysApart === 0 ? "same day" : `${pair.daysApart} day${pair.daysApart === 1 ? "" : "s"} apart`;
  return (
    <article className="sort-card sort-transfer-card">
      <span className="sort-info-pill"><Repeat2 size={15} aria-hidden="true" />Looks like your own money moving</span>
      <div className="sort-transfer-legs">
        <div className="sort-transfer-leg">
          <span><strong>{pair.debit.account}</strong><small>{dateLabel(pair.debit.date)} {"\u00B7"} {"\u201C"}{pair.debit.description}{"\u201D"}</small></span>
          <strong className="sort-transfer-debit">{"\u2212"}<MoneyValue formatted={money(netAmount(pair.debit))} hidden={financialValuesHidden} /></strong>
        </div>
        <div className="sort-transfer-arrow"><ArrowDown size={20} aria-hidden="true" /></div>
        <div className="sort-transfer-leg">
          <span><strong>{pair.credit.account}</strong><small>{dateLabel(pair.credit.date)} {"\u00B7"} {"\u201C"}{pair.credit.description}{"\u201D"}</small></span>
          <strong className="sort-transfer-credit">+<MoneyValue formatted={money(netAmount(pair.credit))} hidden={financialValuesHidden} /></strong>
        </div>
      </div>
      <p className="sort-transfer-stake">
        Same amount, {distance}, both your accounts. If this is a card payment it is <strong>not spending</strong> {"\u2014"} counting it would inflate {month} by <MoneyValue formatted={money(netAmount(pair.debit))} hidden={financialValuesHidden} />.
      </p>
      <div className="sort-transfer-actions">
        <Button variant="primary" onClick={onConfirm}>Yes {"\u2014"} one transfer</Button>
        <Button variant="secondary" onClick={onReject}>No {"\u2014"} two separate things</Button>
      </div>
      <p className="sort-transfer-footnote">Mizan won't decide this for you. Your answer is remembered for this pair, and the same pair will never be asked about twice.</p>
    </article>
  );
}

function SplitRatioPreview({
  transaction,
  ratio,
  choice,
  money,
  financialValuesHidden,
  onApply,
  onAdjust,
  onAllGroceries,
}: {
  transaction: Transaction;
  ratio: Split;
  choice: CategoryChoice;
  money: (value: number) => string;
  financialValuesHidden: boolean;
  onApply: () => void;
  onAdjust: () => void;
  onAllGroceries: () => void;
}) {
  const amounts = splitAmounts(transaction.amount, ratio);
  const total = amounts.mine + amounts.other;
  const mineWidth = total > 0 ? (amounts.mine / total) * 100 : 0;
  return (
    <section className="sort-split-card" aria-label="Remembered split ratio">
      <p className="sort-split-intro">Last time this merchant was split, you used a {ratio.mine}/{ratio.of} share. Want to use that ratio again?</p>
      <div className="sort-split-rows">
        <div className="sort-split-row">
          <div className="sort-split-row-label"><span className="sort-category-dot" style={{ background: choice.color }} />{choice.label}<strong><MoneyValue formatted={money(amounts.mine)} hidden={financialValuesHidden} /></strong></div>
          <div className="sort-split-bar"><span style={{ width: `${mineWidth}%`, background: choice.color }} /></div>
        </div>
        <div className="sort-split-row">
          <div className="sort-split-row-label"><span className="sort-category-dot" style={{ background: "var(--ql-brand-tint)" }} />Other share<strong><MoneyValue formatted={money(amounts.other)} hidden={financialValuesHidden} /></strong></div>
          <div className="sort-split-bar"><span style={{ width: `${100 - mineWidth}%`, background: "var(--ql-brand-tint)" }} /></div>
        </div>
      </div>
      <div className="sort-split-total"><span>Adds up to</span><strong><MoneyValue formatted={money(total)} hidden={financialValuesHidden} /> {"\u00B7"} exact</strong></div>
      <div className="sort-split-actions">
        <Button variant="primary" onClick={onApply}>Split it that way</Button>
        <div>
          <Button variant="secondary" onClick={onAdjust}>Adjust</Button>
          <Button variant="secondary" onClick={onAllGroceries}>All groceries</Button>
        </div>
      </div>
      <p className="sort-split-footnote">A remembered <strong>ratio</strong>, never a remembered amount {"\u2014"} the split always totals the real charge to the cent.</p>
    </section>
  );
}

export function SortView({
  queue,
  transferCandidates,
  members,
  allTransactions = [],
  money,
  financialValuesHidden = false,
  undoLabel,
  onCategorizeMerchant,
  onCategorizeMerchants,
  onSaveSplit,
  onAdjustSplit,
  onConfirmTransfer,
  onRejectTransfer,
  onUndo,
}: SortViewProps) {
  const solo = members.length === 1;
  const [skipped, setSkipped] = useState<Set<string>>(() => new Set());
  const [sorted, setSorted] = useState<string[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<CategoryKey>("food");
  const [selectedBeneficiary, setSelectedBeneficiary] = useState<SortBeneficiary>("household");
  const [initialQueueCount, setInitialQueueCount] = useState(queue.length);
  const memberKeys = useMemo(() => memberKeyLabels(members), [members]);
  const pendingMerchants = useMemo(
    () => queue.filter((item) => !skipped.has(item.merchant)),
    [queue, skipped],
  );
  const current = pendingMerchants[0];
  const currentCharges = useMemo(() => {
    if (!current) return [];
    const matching = allTransactions.filter((transaction) => merchantMatch(transaction, current.merchant));
    const unresolved = matching.filter(needsClassificationReview);
    return (unresolved.length ? unresolved : matching).sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  }, [allTransactions, current]);
  const matchingCharges = useMemo(
    () => current ? allTransactions.filter((transaction) => merchantMatch(transaction, current.merchant)) : [],
    [allTransactions, current],
  );
  const rememberedSplit = useMemo(() => {
    if (!current || currentCharges.length === 0) return null;
    const counts = new Map<string, { split: Split; count: number }>();
    const currentChargeIds = new Set(currentCharges.map((transaction) => transaction.id));
    for (const transaction of matchingCharges) {
      if (currentChargeIds.has(transaction.id)) continue;
      if (!transaction.split || transaction.split.of < 2) continue;
      const mine = Math.max(0, Math.round(transaction.split.mine));
      const of = Math.max(2, Math.round(transaction.split.of));
      const key = `${mine}/${of}`;
      const entry = counts.get(key);
      counts.set(key, entry ? { ...entry, count: entry.count + 1 } : { split: { mine, of }, count: 1 });
    }
    const winner = [...counts.values()]
      .filter((entry) => entry.count >= 2)
      .sort((a, b) => b.count - a.count || a.split.of - b.split.of || a.split.mine - b.split.mine)[0];
    return winner?.split ?? null;
  }, [current, currentCharges.length, matchingCharges]);
  const currentChoice = categoryChoiceFor(selectedCategory) ?? CATEGORY_CHOICES[0]!;
  const currentCharge = currentCharges[0];
  const sortedSet = useMemo(() => new Set(sorted), [sorted]);
  const completedCount = sorted.length + skipped.size;
  const progressTotal = Math.max(1, initialQueueCount, completedCount);
  const progressPercent = Math.min(100, (completedCount / progressTotal) * 100);
  const remainingCount = pendingMerchants.length;
  const backfillCount = matchingCharges.length || current?.count || 0;
  const accountContext = [...new Set(currentCharges.map((transaction) => transaction.account).filter(Boolean))];
  const biggestCharge = currentCharges.reduce((largest, transaction) => Math.max(largest, netAmount(transaction)), 0);

  const resetSelectionFor = (item: ReviewItem | undefined) => {
    const suggested = item?.suggestedCategory && categoryChoiceFor(item.suggestedCategory)
      ? item.suggestedCategory
      : "food";
    setSelectedCategory(suggested);
    const suggestedBeneficiary = item?.suggestedBeneficiary;
    if (solo) setSelectedBeneficiary("household");
    else if (suggestedBeneficiary?.type === "member") setSelectedBeneficiary(`member:${suggestedBeneficiary.memberId}`);
    else setSelectedBeneficiary("household");
  };

  useEffect(() => {
    if (queue.length > initialQueueCount) setInitialQueueCount(queue.length);
  }, [initialQueueCount, queue.length]);

  useEffect(() => {
    resetSelectionFor(current);
    // The merchant key is the unit of work; resetting only when it changes keeps
    // a category click from wiping the user's current choice.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.merchant, solo]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      const editing = target instanceof HTMLElement && target.matches("input, select, textarea, [contenteditable='true']");
      const interactive = target instanceof HTMLElement && target.closest("button, input, select, textarea, [contenteditable='true'], [role='dialog']");
      if (editing || interactive) return;
      if (event.metaKey || event.ctrlKey) {
        if (event.key.toLowerCase() === "z") {
          event.preventDefault();
          onUndo();
        }
        return;
      }
      if (transferCandidates.length > 0 || !current) return;
      if (event.key >= "1" && event.key <= "6") {
        event.preventDefault();
        setSelectedCategory(CATEGORY_CHOICES[Number(event.key) - 1]!.key);
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        if (rememberedSplit && currentCharge) {
          onSaveSplit(currentCharge.id, rememberedSplit);
          onCategorizeMerchants([{ merchant: current.merchant, rule: ruleFor(selectedCategory, selectedBeneficiary, solo) }]);
        } else {
          const rule = ruleFor(selectedCategory, selectedBeneficiary, solo);
          onCategorizeMerchant(current.merchant, rule);
        }
        setSorted((items) => items.includes(current.merchant) ? items : [...items, current.merchant]);
        return;
      }
      if (event.key === "ArrowRight") {
        event.preventDefault();
        setSkipped((items) => new Set(items).add(current.merchant));
        return;
      }
      const key = event.key.toUpperCase();
      const member = members.find((candidate) => (memberKeys.get(candidate.id) ?? "").charAt(0) === key);
      if (member) {
        event.preventDefault();
        setSelectedBeneficiary(`member:${member.id}`);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [current, currentCharge, memberKeys, members, onCategorizeMerchant, onCategorizeMerchants, onSaveSplit, onUndo, rememberedSplit, selectedBeneficiary, selectedCategory, solo, transferCandidates.length]);

  const commit = (category: CategoryKey = selectedCategory, useBatch = false) => {
    if (!current) return;
    const rule = ruleFor(category, selectedBeneficiary, solo);
    if (useBatch) onCategorizeMerchants([{ merchant: current.merchant, rule }]);
    else onCategorizeMerchant(current.merchant, rule);
    setSorted((items) => items.includes(current.merchant) ? items : [...items, current.merchant]);
  };

  const skip = () => {
    if (!current) return;
    setSkipped((items) => new Set(items).add(current.merchant));
  };

  const headerTitle = remainingCount
    ? `${remainingCount} merchant${remainingCount === 1 ? "" : "s"} left to teach.`
    : "Nothing is waiting to be sorted.";
  const estimateSeconds = Math.max(0, remainingCount * 4);

  return (
    <div className="sort-view">
      <header className="sort-view-header sort-view-header-wide">
        <div>
          <span className="mz-eyebrow">Step 2 of the weekly close</span>
          <h1 className="mz-display-l">{headerTitle}</h1>
          <p className="mz-body">Each one you name now is named forever {"\u2014"} and backfills your history.</p>
        </div>
        <div className="sort-progress" aria-label={`${completedCount} of ${progressTotal} merchants sorted`}>
          <strong className="mz-display-l">{completedCount}<span> / {progressTotal}</span></strong>
          <div className="sort-progress-track"><span style={{ width: `${progressPercent}%` }} /></div>
          <small>about {estimateSeconds} seconds left</small>
        </div>
      </header>

      {transferCandidates[0] ? (
        <div className="sort-layout sort-layout-transfer">
          <div>
            <TransferReview
              pair={transferCandidates[0]}
              money={money}
              financialValuesHidden={financialValuesHidden}
              onConfirm={() => onConfirmTransfer(transferCandidates[0]!.debit.id, transferCandidates[0]!.credit.id)}
              onReject={() => onRejectTransfer(transferCandidates[0]!.debit.id, transferCandidates[0]!.credit.id)}
            />
          </div>
          <aside className="sort-side-column">
            <section className="sort-subtle-card"><span className="sort-side-label">First, check the movement</span><p>Transfers are not spending. Confirming this pair keeps July from counting the same money twice.</p></section>
          </aside>
        </div>
      ) : current ? (
        <div className="sort-layout">
          <article className="sort-card">
            <div className="sort-card-heading">
              <div>
              <span className="sort-card-eyebrow">New merchant {"\u00B7"} {completedCount + 1} of {progressTotal}</span>
                <h2>{current.merchant}</h2>
              <p>{currentCharges.length || current.count} charge{(currentCharges.length || current.count) === 1 ? "" : "s"} since {currentCharges[0] ? dateLabel(currentCharges[0].date) : "the last statement"} {"\u00B7"} {accountContext[0] ?? "your account"} {"\u00B7"} biggest <MoneyValue formatted={money(biggestCharge || current.total)} hidden={financialValuesHidden} /></p>
              </div>
              <strong className="sort-card-total"><MoneyValue formatted={money(current.total)} hidden={financialValuesHidden} /></strong>
            </div>

            <section className="sort-choice-group">
              <div className="sort-choice-heading"><span>What for</span><small>press 1 {"\u2013"} 6</small></div>
              <div className="sort-choice-list" role="group" aria-label={`Category for ${current.merchant}`}>
                {CATEGORY_CHOICES.map((choice, index) => (
                  <button
                    key={choice.key}
                    type="button"
                    className={`sort-choice ${choice.dashed ? "dashed" : ""} ${selectedCategory === choice.key ? "selected" : ""}`.trim()}
                    aria-pressed={selectedCategory === choice.key}
                    onClick={() => setSelectedCategory(choice.key)}
                  >
                    <b className="sort-keycap">{index + 1}</b>{choice.label}
                  </button>
                ))}
              </div>
            </section>

            {!solo && (
              <section className="sort-choice-group">
                <div className="sort-choice-heading"><span>Who for</span><small>press {members.map((member) => memberKeys.get(member.id)).join(" / ")}</small></div>
                <div className="sort-choice-list sort-beneficiary-list" role="group" aria-label={`Who was it for: ${current.merchant}`}>
                  <button type="button" className={`sort-choice ${selectedBeneficiary === "household" ? "selected" : ""}`.trim()} aria-pressed={selectedBeneficiary === "household"} onClick={() => setSelectedBeneficiary("household")}>
                    <b className="sort-keycap">B</b>Both of us
                  </button>
                  {members.map((member) => {
                    const key = memberKeys.get(member.id) ?? member.name.charAt(0).toUpperCase();
                    return (
                      <button key={member.id} type="button" className={`sort-choice ${selectedBeneficiary === `member:${member.id}` ? "selected" : ""}`.trim()} aria-pressed={selectedBeneficiary === `member:${member.id}`} onClick={() => setSelectedBeneficiary(`member:${member.id}`)}>
                        <b className="sort-keycap"><span className="sort-member-dot" style={{ background: member.color }} />{key}</b>{member.name}
                      </button>
                    );
                  })}
                </div>
              </section>
            )}

            {rememberedSplit && currentCharge && (
              <SplitRatioPreview
                transaction={currentCharge}
                ratio={rememberedSplit}
                choice={currentChoice}
                money={money}
                financialValuesHidden={financialValuesHidden}
                onApply={() => {
                  onSaveSplit(currentCharge.id, rememberedSplit);
                  commit(selectedCategory, true);
                }}
                onAdjust={() => onAdjustSplit(currentCharge)}
                onAllGroceries={() => commit("food")}
              />
            )}

            <div className="sort-rule-confirmation">
              <span className="sort-confirmation-icon"><Check size={14} aria-hidden="true" /></span>
              <span><strong>Make it a rule.</strong> Future {current.merchant} charges land in {currentChoice.label} {"\u00B7"} {solo ? members[0]?.name ?? "you" : selectedBeneficiary === "household" ? "Both" : members.find((member) => `member:${member.id}` === selectedBeneficiary)?.name ?? "your chosen member"} {"\u2014"} and the <strong>{backfillCount} older {backfillCount === 1 ? "one" : "ones"}</strong> in your history get corrected too.</span>
            </div>

            <div className="sort-card-actions">
              <Button variant="primary" onClick={() => commit()}>Sort it <b className="sort-action-keycap">{"\u21B5"}</b></Button>
              <Button variant="secondary" onClick={skip}>Skip <b className="sort-action-keycap">{"\u2192"}</b></Button>
              <Button variant="ghost" className="sort-undo-button" disabled={!undoLabel} onClick={onUndo}>Undo last {"\u00B7"} <b>{"\u2318"}Z</b></Button>
            </div>
          </article>

          <aside className="sort-side-column">
            <section className="sort-charges-card">
              <span className="sort-side-label">The {currentCharges.length || current.count} charge{(currentCharges.length || current.count) === 1 ? "" : "s"}</span>
              <div className="sort-charge-list">
                {currentCharges.map((transaction) => (
                  <div className="sort-charge-row" key={transaction.id}><span>{dateLabel(transaction.date)} {"\u00B7"} {transaction.account}</span><strong><MoneyValue formatted={money(netAmount(transaction))} hidden={financialValuesHidden} /></strong></div>
                ))}
              </div>
            </section>
            <section className="sort-subtle-card"><span className="sort-side-label">What this fixes</span><p>These are <strong>already in your spend total</strong>. Sorting moves them out of “unassigned” so the breakdown is honest.</p></section>
            <section className="sort-session-card"><span className="sort-side-label">Sorted this session</span><div className="sort-session-pills">{sorted.map((merchant) => <span key={merchant}>{merchant} <b>✓</b></span>)}</div><p>{sortedSet.size} rule{sortedSet.size === 1 ? "" : "s"} taught. Next month these sort themselves and this list starts near empty.</p></section>
          </aside>
        </div>
      ) : (
        <section className="ledger-empty-state sort-complete-state">
          <span className="soft-label">Sort</span>
          <h3>{skipped.size ? "You can come back to these later" : "Everything has a default"}</h3>
          <p>{skipped.size ? `${skipped.size} merchant${skipped.size === 1 ? "" : "s"} skipped for now.` : "New merchants will appear here after the next statement import."}</p>
        </section>
      )}
    </div>
  );
}
