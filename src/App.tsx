import { useEffect, useMemo, useState } from "react";
import { applyAccounts, resolveAccountLabel } from "./domain/accounts";
import { isoDateOf, monthLabel, monthOf } from "./domain/dates";
import { filterNew } from "./domain/dedupe";
import { formatMoney } from "./domain/money";
import { applyRules, withRule } from "./domain/rules";
import { computeHistory, computeMonthSummary, monthsWithData, reviewQueue } from "./domain/summary";
import { personalCategory, uid, type AppData, type CategoryKey, type Member, type OwnerFilter, type Split, type Transaction } from "./domain/types";
import { parsersFor } from "./import/registry";
import { clearData, loadData, parseBackup, saveData, serializeBackup } from "./storage/localStore";
import { HistoryView } from "./ui/HistoryView";
import { HomeView } from "./ui/HomeView";
import { ImportModal, type ImportResult } from "./ui/ImportModal";
import { CsvImportModal } from "./ui/CsvImportModal";
import { ManualModal, type ManualEntry } from "./ui/ManualModal";
import { OnboardingView } from "./ui/OnboardingView";
import { SettingsModal } from "./ui/SettingsModal";
import { SplitModal } from "./ui/SplitModal";
import { TransactionsView } from "./ui/TransactionsView";

type View = "home" | "transactions" | "history";
type ModalKind = null | "import" | "manual" | "settings";

const VIEW_TITLES: Record<View, string> = {
  home: "Monthly check-in",
  transactions: "Transactions",
  history: "Month by month",
};

export default function App() {
  const [data, setData] = useState<AppData>(loadData);
  const [view, setView] = useState<View>("home");
  const [month, setMonth] = useState("");
  const [owner, setOwner] = useState<OwnerFilter>("all");
  const [privacy, setPrivacy] = useState(() => typeof localStorage !== "undefined" && localStorage.getItem("mizan.privacy") === "true");
  const [categoryFilter, setCategoryFilter] = useState<CategoryKey | "all">("all");
  const [notice, setNotice] = useState("");
  const [modal, setModal] = useState<ModalKind>(null);
  const [splitTxn, setSplitTxn] = useState<Transaction | null>(null);
  const [csvFile, setCsvFile] = useState<File | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => saveData(data), 250);
    return () => window.clearTimeout(timer);
  }, [data]);

  useEffect(() => {
    localStorage.setItem("mizan.privacy", String(privacy));
  }, [privacy]);

  const today = new Date();
  const todayMonth = isoDateOf(today).slice(0, 7);
  const months = useMemo(() => monthsWithData(data, new Date()), [data]);
  const currentMonth = month || months[months.length - 1] || todayMonth;
  const summary = useMemo(
    () => computeMonthSummary(data, currentMonth, owner, new Date()),
    [data, currentMonth, owner],
  );
  const queue = useMemo(() => reviewQueue(data.transactions), [data]);
  const history = useMemo(() => computeHistory(data, months), [data, months]);
  const money = (value: number) =>
    privacy ? "Hidden" : formatMoney(value, { currency: data.settings.currency, locale: data.settings.locale });

  function setTransactionCategory(id: string, category: CategoryKey) {
    setData((previous) => {
      const txn = previous.transactions.find((item) => item.id === id);
      if (!txn) return previous;
      const merchantRules = withRule(previous.merchantRules, txn.description, category);
      const transactions = applyRules(
        previous.transactions.map((item) => (item.id === id ? { ...item, category } : item)),
        merchantRules,
      );
      return { ...previous, merchantRules, transactions };
    });
  }

  function categorizeMerchant(merchant: string, category: CategoryKey) {
    setData((previous) => {
      const merchantRules = withRule(previous.merchantRules, merchant, category);
      return { ...previous, merchantRules, transactions: applyRules(previous.transactions, merchantRules) };
    });
  }

  function addManual(entry: ManualEntry) {
    const account = resolveAccountLabel(entry.account, data.accounts);
    const txn: Transaction = { id: uid("txn"), source: "manual", direction: "debit", ...entry, account };
    setData((previous) => ({
      ...previous,
      transactions: [...previous.transactions, txn].sort((a, b) => a.date.localeCompare(b.date)),
    }));
    setMonth(monthOf(txn.date));
  }

  /** Shared tail for every import route: apply accounts + rules, dedupe, store, notify. */
  function ingestTransactions(parsed: Transaction[], failures: string[], extraNotes: string[] = []): ImportResult {
    const ruled = applyRules(applyAccounts(parsed, data.accounts), data.merchantRules);
    const fresh = filterNew(data.transactions, ruled);
    const needsReview = fresh.filter((txn) => txn.category === "uncategorized" && txn.direction !== "credit").length;
    if (fresh.length) {
      setData((previous) => ({
        ...previous,
        transactions: [...previous.transactions, ...filterNew(previous.transactions, ruled)].sort((a, b) =>
          a.date.localeCompare(b.date),
        ),
      }));
      setMonth(monthOf(fresh[fresh.length - 1]!.date));
    }

    const parts = [
      `Imported ${fresh.length} transaction${fresh.length === 1 ? "" : "s"}; skipped ${ruled.length - fresh.length} duplicate${ruled.length - fresh.length === 1 ? "" : "s"}.`,
      needsReview ? `${needsReview} need a category — see the review queue under Transactions.` : "",
      ...extraNotes,
      ...failures,
    ].filter(Boolean);
    setNotice(parts.join(" "));
    if (needsReview) setView("transactions");
    return { imported: fresh.length, duplicates: ruled.length - fresh.length, needsReview, failures };
  }

  async function importStatements(
    files: File[],
    passwords: Record<string, string>,
    onProgress: (step: string) => void,
  ): Promise<ImportResult> {
    const parsed: Transaction[] = [];
    const failures: string[] = [];
    for (const file of files) {
      try {
        const [parser] = parsersFor(file);
        if (!parser) throw new Error(`Unrecognized statement format: ${file.name}`);
        onProgress(`Parsing ${file.name}`);
        parsed.push(...(await parser.parse(file, passwords[parser.id] ?? "")));
      } catch (error) {
        failures.push(`${file.name}: ${(error as Error).message}`);
      }
    }
    return ingestTransactions(parsed, failures);
  }

  function updateMembers(members: Member[]) {
    setData((previous) => {
      const removed = previous.settings.members.filter((m) => !members.some((next) => next.id === m.id)).map((m) => m.id);
      if (!removed.length) {
        return { ...previous, settings: { ...previous.settings, members } };
      }
      // Reassign anything that pointed at a removed member so no data is orphaned.
      const removedCategories = new Set<CategoryKey>(removed.map(personalCategory));
      const transactions = previous.transactions.map((txn) =>
        removedCategories.has(txn.category) ? { ...txn, category: "uncategorized" as CategoryKey } : txn,
      );
      const fixedCosts = previous.fixedCosts.map((cost) =>
        removedCategories.has(cost.category) ? { ...cost, category: "uncategorized" as CategoryKey } : cost,
      );
      const merchantRules = Object.fromEntries(
        Object.entries(previous.merchantRules).filter(([, category]) => !removedCategories.has(category)),
      );
      const accounts = previous.accounts.map((account) =>
        removed.includes(account.owner) ? { ...account, owner: "joint" } : account,
      );
      return { ...previous, transactions, fixedCosts, merchantRules, accounts, settings: { ...previous.settings, members } };
    });
  }

  function saveSplit(id: string, split: Split) {
    setData((previous) => ({
      ...previous,
      transactions: previous.transactions.map((txn) => (txn.id === id ? { ...txn, split } : txn)),
    }));
  }

  function clearSplit(id: string) {
    setData((previous) => ({
      ...previous,
      transactions: previous.transactions.map((txn) => {
        if (txn.id !== id) return txn;
        const { split: _removed, ...rest } = txn;
        return rest;
      }),
    }));
  }

  function removeTransaction(id: string) {
    setData((previous) => ({ ...previous, transactions: previous.transactions.filter((txn) => txn.id !== id) }));
  }

  function deleteRule(merchant: string) {
    setData((previous) => {
      const merchantRules = { ...previous.merchantRules };
      delete merchantRules[merchant];
      return { ...previous, merchantRules };
    });
  }

  function exportBackup() {
    const blob = new Blob([serializeBackup(data)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `mizan-backup-${isoDateOf(new Date())}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  function importBackup(file: File) {
    if (
      !window.confirm(
        "Import this backup? It will replace everything currently in Mizan — transactions, rules, and your account registry (owners and match patterns). Export a backup first if in doubt.",
      )
    ) {
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      try {
        setData(parseBackup(String(reader.result)));
        setNotice("Backup imported.");
      } catch {
        setNotice("That backup file could not be read.");
      }
    };
    reader.readAsText(file);
  }

  function clearAllData() {
    if (!window.confirm("Clear all Mizan data from this browser? Export a JSON backup first if in doubt.")) return;
    clearData();
    setData(loadData());
    setMonth("");
    setNotice("Local data cleared.");
  }

  const monthIndex = months.indexOf(currentMonth);
  const streakExtending = summary.saveRate >= summary.targetSaveRate;

  if (!data.settings.members.length) {
    return (
      <OnboardingView
        onComplete={(result) => setData((previous) => ({ ...previous, settings: { ...previous.settings, ...result } }))}
      />
    );
  }

  return (
    <main className="app">
      <header className="topbar">
        <div className="wordmark"><span className="dot" />MIZAN</div>
        <div className="month-nav">
          <button aria-label="Previous month" onClick={() => monthIndex > 0 && setMonth(months[monthIndex - 1]!)}>‹</button>
          <span className="label">{monthLabel(currentMonth).toUpperCase()}</span>
          <button
            aria-label="Next month"
            onClick={() => monthIndex >= 0 && monthIndex < months.length - 1 && setMonth(months[monthIndex + 1]!)}
          >
            ›
          </button>
        </div>
        <div className="top-actions">
          <button className="icon-btn" title="Import statements" onClick={() => setModal("import")}>↑</button>
          <button className="icon-btn" title="Add entry" onClick={() => setModal("manual")}>+</button>
          <button className="icon-btn" title={privacy ? "Show amounts" : "Hide amounts"} onClick={() => setPrivacy((value) => !value)}>
            {privacy ? "◌" : "●"}
          </button>
          <button className="icon-btn" title="Settings" onClick={() => setModal("settings")}>⚙</button>
        </div>
      </header>

      <nav className="nav-strip">
        {(
          [
            ["home", "Home"],
            ["transactions", "Transactions"],
            ["history", "History"],
          ] as const
        ).map(([id, label]) => (
          <button key={id} className={`nav-item ${view === id ? "active" : ""}`} onClick={() => setView(id)}>
            {label}
          </button>
        ))}
        <span className="spacer" />
        <div className="person-seg" role="tablist" aria-label="Filter by person">
          <button
            role="tab"
            aria-selected={owner === "all"}
            className={`ps-btn ${owner === "all" ? "active" : ""}`}
            onClick={() => setOwner("all")}
          >
            All
          </button>
          {data.settings.members.map((member) => (
            <button
              key={member.id}
              role="tab"
              aria-selected={owner === member.id}
              className={`ps-btn ${owner === member.id ? "active" : ""}`}
              style={owner === member.id ? ({ "--person": member.color } as React.CSSProperties) : undefined}
              onClick={() => setOwner(member.id)}
            >
              <span className="ps-dot" style={{ background: member.color }} />
              {member.name}
            </button>
          ))}
        </div>
        <span className="ticker">
          {privacy && <span className="privacy-pill"><span className="dot" />PRIVACY</span>}
          {summary.uncategorizedCount > 0 && (
            <button className="ticker-chip uncat" onClick={() => setView("transactions")}>
              <span className="tk-k">REVIEW </span><span className="tk-v">{summary.uncategorizedCount}</span>
            </button>
          )}
          <span className="streak">
            <span className="tk-k">SAVE </span><span className="tk-v">{Math.round(summary.saveRate)}%</span>
            <span className={streakExtending ? "up" : "down"}>{streakExtending ? "↑ On target" : "↓ At risk"}</span>
          </span>
          <span><span className="tk-k">DAY </span><span className="tk-v">{summary.dayNumber}/{summary.daysInMonth}</span></span>
          <span><span className="tk-k">TXNS </span><span className="tk-v">{data.transactions.length}</span></span>
        </span>
      </nav>

      <section className="workspace">
        <header className="viewbar">
          <div className="title-lockup">
            <p className="eyebrow">{data.settings.members.map((member) => member.name).join(" + ") || "Household"}</p>
            <h2>{VIEW_TITLES[view]}</h2>
            <span>What needs attention, what is fine, and what changed.</span>
          </div>
          <div className="actions">
            <select value={currentMonth} onChange={(event) => setMonth(event.target.value)}>
              {months.map((item) => (
                <option key={item} value={item}>{monthLabel(item)}</option>
              ))}
            </select>
            <button className="secondary" onClick={() => setModal("manual")}>+ Manual</button>
            <button onClick={() => setModal("import")}>Import</button>
          </div>
        </header>

        {notice && <div className="notice">{notice}</div>}

        {view === "home" && <HomeView summary={summary} money={money} onOpenSettings={() => setModal("settings")} />}
        {view === "transactions" && (
          <TransactionsView
            summary={summary}
            members={data.settings.members}
            queue={queue}
            categoryFilter={categoryFilter}
            onCategoryFilter={setCategoryFilter}
            money={money}
            onSetCategory={setTransactionCategory}
            onCategorizeMerchant={categorizeMerchant}
            onSplit={setSplitTxn}
            onRemove={removeTransaction}
          />
        )}
        {view === "history" && <HistoryView rows={history} targetSaveRate={summary.targetSaveRate} money={money} />}
      </section>

      {modal === "import" && (
        <ImportModal
          onImport={importStatements}
          onCsv={(file) => {
            setModal(null);
            setCsvFile(file);
          }}
          onClose={() => setModal(null)}
        />
      )}
      {csvFile && (
        <CsvImportModal
          file={csvFile}
          presets={data.settings.csvPresets}
          onImport={(transactions, skipped) =>
            ingestTransactions(transactions, [], skipped ? [`${skipped} CSV row${skipped === 1 ? "" : "s"} skipped.`] : [])
          }
          onSavePreset={(signature, mapping) =>
            setData((previous) => ({
              ...previous,
              settings: { ...previous.settings, csvPresets: { ...previous.settings.csvPresets, [signature]: mapping } },
            }))
          }
          onClose={() => setCsvFile(null)}
        />
      )}
      {modal === "manual" && (
        <ManualModal
          accountOptions={data.accounts.map((account) => account.label)}
          members={data.settings.members}
          onAdd={addManual}
          onClose={() => setModal(null)}
        />
      )}
      {modal === "settings" && (
        <SettingsModal
          data={data}
          onUpdateMembers={updateMembers}
          onUpdateTarget={(targetSaveRate) =>
            setData((previous) => ({ ...previous, settings: { ...previous.settings, targetSaveRate } }))
          }
          onUpdateCurrency={(currency, locale) =>
            setData((previous) => ({ ...previous, settings: { ...previous.settings, currency, locale } }))
          }
          onUpdateFixedCosts={(fixedCosts) => setData((previous) => ({ ...previous, fixedCosts }))}
          onUpdateAccounts={(accounts) =>
            setData((previous) => ({
              ...previous,
              accounts,
              transactions: applyAccounts(previous.transactions, accounts),
            }))
          }
          onDeleteRule={deleteRule}
          onExport={exportBackup}
          onImportBackup={importBackup}
          onClearData={clearAllData}
          onClose={() => setModal(null)}
        />
      )}
      {splitTxn && (
        <SplitModal
          txn={splitTxn}
          onSave={saveSplit}
          onClear={clearSplit}
          onClose={() => setSplitTxn(null)}
        />
      )}
    </main>
  );
}
