import { useEffect, useMemo, useState } from "react";
import { parseCsv } from "../import/csv";
import { csvPresetSignature, headerSignature, inferMapping, mapCsvRows } from "../import/csvMap";
import type { CsvMapping } from "../domain/types";
import { assertCsvFile } from "../security/resourceLimits";
import { AccountCoverageConfirm, type AccountCoverageConfirmation } from "./AccountCoverageConfirm";
import { Button, Modal } from "./bits";
import type { ImportResult } from "./ImportModal";

export function CsvImportModal({
  file,
  extractedRows,
  layoutSignature,
  presets,
  formatAmount = (transaction) => `${transaction.direction === "credit" ? "+" : ""}${transaction.amount}`,
  onImport,
  onSavePreset,
  onConfirmCoverage = () => undefined,
  onClose,
}: {
  file: File;
  /**
   * Rows already extracted from a statement whose layout Mizan does not have a
   * verified parser for. When present the file is not read as CSV: mapping a
   * reconstructed statement table is the same interactive, user-confirmed step,
   * so it reuses this screen rather than growing a second one.
   */
  extractedRows?: string[][];
  /** Preset key for `extractedRows`, derived from the statement's column geometry. */
  layoutSignature?: string;
  presets: Record<string, CsvMapping>;
  formatAmount?: (transaction: ReturnType<typeof mapCsvRows>["transactions"][number]) => string;
  onImport: (transactions: ReturnType<typeof mapCsvRows>["transactions"], skipped: number) => ImportResult | void;
  onSavePreset: (signature: string, mapping: CsvMapping) => void;
  onConfirmCoverage?: (confirmations: AccountCoverageConfirmation[]) => void;
  onClose: () => void;
}) {
  const [rows, setRows] = useState<string[][]>([]);
  const [error, setError] = useState("");
  const [mapping, setMapping] = useState<CsvMapping | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const fromStatement = Boolean(extractedRows?.length);
  const defaultAccount = file.name.replace(/\.(csv|pdf|html?)$/i, "");

  useEffect(() => {
    const start = (parsed: string[][], signature: string) => {
      setRows(parsed);
      const inferred = inferMapping(parsed);
      const preset = presets[signature]
        ?? presets[csvPresetSignature(parsed, inferred.hasHeader)]
        ?? presets[headerSignature(parsed)];
      setMapping({ ...(preset ?? inferred), accountLabel: defaultAccount });
    };

    if (extractedRows?.length) {
      start(extractedRows, layoutSignature ?? "");
      return;
    }

    try {
      assertCsvFile(file);
    } catch (fileError) {
      setError((fileError as Error).message);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = parseCsv(String(reader.result));
        if (!parsed.length) throw new Error("empty file");
        start(parsed, csvPresetSignature(parsed, inferMapping(parsed).hasHeader));
      } catch {
        setError("That file could not be read as CSV.");
      }
    };
    reader.onerror = () => setError("That file could not be read.");
    reader.readAsText(file);
  }, [defaultAccount, file, presets, extractedRows, layoutSignature]);

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
    onSavePreset(layoutSignature || csvPresetSignature(rows, mapping.hasHeader), layout);
    const next = onImport(preview.transactions, preview.skipped.length);
    if (next) setResult(next);
    else onClose();
  };

  const columnSelect = (value: number | undefined, onChange: (index: number) => void) => (
    <select value={value ?? 0} onChange={(event) => onChange(Number(event.target.value))}>
      {columns.map((column) => (
        <option key={column.index} value={column.index}>{column.label}</option>
      ))}
    </select>
  );

  return (
    <Modal title={fromStatement ? "Map statement columns" : "Import CSV"} onClose={onClose} wide>
      {error && <p className="notice" role="alert">{error}</p>}
      {mapping && rows.length > 0 && !result && (
        <>
          <p className="muted">
            {fromStatement
              ? "Mizan has no verified parser for this statement, so it read the table off the page. Check the columns below — nothing is imported until you confirm, and this layout is remembered for next month."
              : "Match your file's columns to Mizan's fields. The preview updates as you choose."}
          </p>

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
                        <td className="right">{formatAmount(txn)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="modal-actions">
            <Button variant="secondary" onClick={onClose}>Cancel</Button>
            <Button variant="primary" onClick={run} disabled={!preview || preview.transactions.length === 0}>
              Import {preview ? preview.transactions.length : 0} transaction{preview?.transactions.length === 1 ? "" : "s"}
            </Button>
          </div>
        </>
      )}
      {result && (
        <div className="import-flow">
          <div className="import-result" role="status">
            <strong>Imported {result.imported}; skipped {result.duplicates} duplicate{result.duplicates === 1 ? "" : "s"}.</strong>
            {result.needsReview ? <span>{result.needsReview} need review.</span> : <span>No review items from this import.</span>}
          </div>
          {result.coverageCandidates?.length ? (
            <AccountCoverageConfirm candidates={result.coverageCandidates} onConfirm={onConfirmCoverage} />
          ) : null}
          <div className="modal-actions">
            <Button variant="primary" onClick={onClose}>Close</Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
