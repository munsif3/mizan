import { useEffect, useMemo, useState } from "react";
import { parseCsv } from "../import/csv";
import { csvPresetSignature, headerSignature, inferMapping, mapCsvRows } from "../import/csvMap";
import type { CsvMapping } from "../domain/types";
import { Modal } from "./bits";

export function CsvImportModal({
  file,
  presets,
  onImport,
  onSavePreset,
  onClose,
}: {
  file: File;
  presets: Record<string, CsvMapping>;
  onImport: (transactions: ReturnType<typeof mapCsvRows>["transactions"], skipped: number) => void;
  onSavePreset: (signature: string, mapping: CsvMapping) => void;
  onClose: () => void;
}) {
  const [rows, setRows] = useState<string[][]>([]);
  const [error, setError] = useState("");
  const [mapping, setMapping] = useState<CsvMapping | null>(null);
  const defaultAccount = file.name.replace(/\.csv$/i, "");

  useEffect(() => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = parseCsv(String(reader.result));
        if (!parsed.length) throw new Error("empty file");
        setRows(parsed);
        const inferred = inferMapping(parsed);
        const signature = csvPresetSignature(parsed, inferred.hasHeader);
        const preset = presets[signature] ?? presets[headerSignature(parsed)];
        setMapping({ ...(preset ?? inferred), accountLabel: defaultAccount });
      } catch {
        setError("That file could not be read as CSV.");
      }
    };
    reader.onerror = () => setError("That file could not be read.");
    reader.readAsText(file);
  }, [defaultAccount, file, presets]);

  const columns = useMemo(() => {
    const header = rows[0] ?? [];
    return header.map((cell, index) => ({ index, label: mapping?.hasHeader && cell.trim() ? cell.trim() : `Column ${index + 1}` }));
  }, [rows, mapping?.hasHeader]);

  const preview = useMemo(() => {
    if (!mapping || !rows.length) return null;
    return mapCsvRows(rows, mapping, mapping.accountLabel?.trim() || defaultAccount);
  }, [rows, mapping, defaultAccount]);

  const patch = (next: Partial<CsvMapping>) => setMapping((current) => (current ? { ...current, ...next } : current));

  const run = () => {
    if (!mapping || !preview) return;
    const layout = { ...mapping };
    delete layout.accountLabel;
    onSavePreset(csvPresetSignature(rows, mapping.hasHeader), layout);
    onImport(preview.transactions, preview.skipped.length);
    onClose();
  };

  const columnSelect = (value: number | undefined, onChange: (index: number) => void) => (
    <select value={value ?? 0} onChange={(event) => onChange(Number(event.target.value))}>
      {columns.map((column) => (
        <option key={column.index} value={column.index}>{column.label}</option>
      ))}
    </select>
  );

  return (
    <Modal title="Import CSV" onClose={onClose} wide>
      {error && <p className="notice">{error}</p>}
      {mapping && rows.length > 0 && (
        <>
          <p className="muted">Match your file's columns to Mizan's fields. The preview updates as you choose.</p>

          <div className="settings-section">
            <label className="checkbox-row">
              <input type="checkbox" checked={mapping.hasHeader} onChange={(event) => patch({ hasHeader: event.target.checked })} />
              <span>First row is a header</span>
            </label>
            <div className="form-grid">
              <label className="field"><span>Date column</span>{columnSelect(mapping.dateColumn, (dateColumn) => patch({ dateColumn }))}</label>
              <label className="field">
                <span>Date order</span>
                <select value={mapping.dateOrder} onChange={(event) => patch({ dateOrder: event.target.value as CsvMapping["dateOrder"] })}>
                  <option value="dmy">Day / Month / Year</option>
                  <option value="mdy">Month / Day / Year</option>
                  <option value="ymd">Year / Month / Day</option>
                </select>
              </label>
              <label className="field"><span>Description column</span>{columnSelect(mapping.descriptionColumn, (descriptionColumn) => patch({ descriptionColumn }))}</label>
              <label className="field">
                <span>Amount style</span>
                <select value={mapping.amountMode} onChange={(event) => patch({ amountMode: event.target.value as CsvMapping["amountMode"] })}>
                  <option value="single">One amount column</option>
                  <option value="debit_credit">Separate debit &amp; credit</option>
                </select>
              </label>
            </div>

            {mapping.amountMode === "single" ? (
              <div className="form-grid">
                <label className="field"><span>Amount column</span>{columnSelect(mapping.amountColumn, (amountColumn) => patch({ amountColumn }))}</label>
                <label className="field">
                  <span>Sign convention</span>
                  <select
                    value={mapping.signConvention ?? "negative_is_credit"}
                    onChange={(event) => patch({ signConvention: event.target.value as CsvMapping["signConvention"] })}
                  >
                    <option value="negative_is_credit">Negative = money in</option>
                    <option value="positive_is_credit">Positive = money in</option>
                    <option value="all_debits">All rows are spending</option>
                  </select>
                </label>
              </div>
            ) : (
              <div className="form-grid">
                <label className="field"><span>Debit (out) column</span>{columnSelect(mapping.debitColumn, (debitColumn) => patch({ debitColumn }))}</label>
                <label className="field"><span>Credit (in) column</span>{columnSelect(mapping.creditColumn, (creditColumn) => patch({ creditColumn }))}</label>
              </div>
            )}

            <div className="form-grid">
              <label className="field">
                <span>Account</span>
                <input
                  value={mapping.accountLabel ?? ""}
                  placeholder="account name for these rows"
                  onChange={(event) => patch({ accountLabel: event.target.value })}
                />
              </label>
            </div>
          </div>

          {preview && (
            <div className="settings-section">
              <h3>Preview</h3>
              <p className="muted">
                {preview.transactions.length} row{preview.transactions.length === 1 ? "" : "s"} ready
                {preview.skipped.length ? `, ${preview.skipped.length} skipped` : ""}.
              </p>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr><th>Date</th><th>Description</th><th>Account</th><th className="right">Amount</th></tr>
                  </thead>
                  <tbody>
                    {preview.transactions.slice(0, 8).map((txn) => (
                      <tr key={txn.id}>
                        <td>{txn.date}</td>
                        <td>{txn.description}</td>
                        <td>{txn.account}</td>
                        <td className="right">{txn.direction === "credit" ? "+" : ""}{txn.amount}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="modal-actions">
            <button className="secondary" onClick={onClose}>Cancel</button>
            <button onClick={run} disabled={!preview || preview.transactions.length === 0}>
              Import {preview ? preview.transactions.length : 0} transaction{preview?.transactions.length === 1 ? "" : "s"}
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}
