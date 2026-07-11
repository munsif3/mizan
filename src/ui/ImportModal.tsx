import { useMemo, useState } from "react";
import { FileSpreadsheet, Landmark } from "lucide-react";
import { parsersFor } from "../import/registry";
import type { StatementParser } from "../import/types";
import { Modal } from "./bits";

export interface ImportResult {
  imported: number;
  duplicates: number;
  needsReview: number;
  failures: string[];
}

type ImportMode = "statement" | "csv";

export function ImportModal({
  onImport,
  onCsv,
  onReview,
  onClose,
}: {
  onImport: (
    files: File[],
    passwords: Record<string, string>,
    onProgress: (step: string) => void,
  ) => Promise<ImportResult>;
  onCsv: (file: File) => void;
  onReview: () => void;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<ImportMode>("statement");
  const [files, setFiles] = useState<File[]>([]);
  const [passwords, setPasswords] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState("");
  const [result, setResult] = useState<ImportResult | null>(null);

  function chooseFiles(selected: File[]) {
    setResult(null);
    if (mode === "csv") {
      const csv = selected.find((file) => /\.csv$/i.test(file.name));
      if (csv) onCsv(csv);
      return;
    }
    setFiles(selected.filter((file) => /\.(html?|pdf)$/i.test(file.name)));
  }

  const neededParsers = useMemo(() => {
    const byId = new Map<string, StatementParser>();
    for (const file of files) {
      const [parser] = parsersFor(file);
      if (parser) byId.set(parser.id, parser);
    }
    return [...byId.values()];
  }, [files]);

  async function run() {
    if (!files.length) return;
    setResult(null);
    setBusy("Reading statements");
    try {
      setResult(await onImport(files, passwords, setBusy));
    } finally {
      setBusy("");
    }
  }

  return (
    <Modal title="Import" onClose={() => !busy && onClose()}>
      <div className="import-flow">
        <div className="import-choice" role="tablist" aria-label="Import type">
          <button
            className={mode === "statement" ? "active" : ""}
            role="tab"
            aria-selected={mode === "statement"}
            onClick={() => {
              setMode("statement");
              setFiles([]);
              setResult(null);
            }}
          >
            <Landmark size={18} aria-hidden="true" />
            Bank statement
          </button>
          <button
            className={mode === "csv" ? "active" : ""}
            role="tab"
            aria-selected={mode === "csv"}
            onClick={() => {
              setMode("csv");
              setFiles([]);
              setResult(null);
            }}
          >
            <FileSpreadsheet size={18} aria-hidden="true" />
            CSV export
          </button>
        </div>

        <label className="dropzone">
          <input
            type="file"
            accept={mode === "csv" ? ".csv" : ".html,.htm,.pdf"}
            multiple={mode === "statement"}
            onChange={(event) => chooseFiles(Array.from(event.target.files ?? []))}
          />
          <strong>
            {files.length
              ? `${files.length} file${files.length === 1 ? "" : "s"} selected`
              : mode === "csv"
                ? "Choose a CSV export"
                : "Choose HTML or PDF statements"}
          </strong>
          <span>
            {files.map((file) => file.name).join(", ") ||
              (mode === "csv" ? "CSV opens a column-mapping step next." : "Duplicates are skipped by date, merchant, amount, and account.")}
          </span>
        </label>

        {neededParsers.map((parser) => (
          <label className="field" key={parser.id}>
            <span>{parser.passwordLabel}</span>
            <input
              type="password"
              value={passwords[parser.id] ?? ""}
              onChange={(event) => {
                setPasswords((previous) => ({ ...previous, [parser.id]: event.target.value }));
                setResult(null);
              }}
              placeholder={parser.passwordPlaceholder}
            />
          </label>
        ))}

        <p className="muted">Files and passwords are processed in this browser. Raw bank files are not uploaded by Mizan.</p>

        {result && (
          <div className="import-result" role="status">
            <strong>Imported {result.imported}; skipped {result.duplicates} duplicate{result.duplicates === 1 ? "" : "s"}.</strong>
            {result.needsReview ? <span>{result.needsReview} need review before the month is clean.</span> : <span>No review items from this import.</span>}
            {result.failures.map((failure) => <small key={failure}>{failure}</small>)}
          </div>
        )}

        <div className="modal-actions">
          <button className="secondary" onClick={onClose} disabled={!!busy}>Cancel</button>
          {result?.needsReview ? <button onClick={onReview}>Review queue</button> : null}
          {result && !result.needsReview && !result.failures.length ? <button onClick={onClose}>Done</button> : null}
          {mode === "statement" && (!result || result.failures.length) ? (
            <button onClick={run} disabled={!files.length || !!busy}>
              {busy || (result?.failures.length ? "Retry import" : "Import")}
            </button>
          ) : null}
        </div>
      </div>
    </Modal>
  );
}
