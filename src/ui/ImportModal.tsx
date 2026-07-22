import { useMemo, useState } from "react";
import { FileSpreadsheet, Landmark } from "lucide-react";
import { parsersFor } from "../import/registry";
import type { StatementParser } from "../import/types";
import { assertCsvFile, assertStatementFiles } from "../security/resourceLimits";
import {
  AccountCoverageConfirm,
  type AccountCoverageCandidate,
  type AccountCoverageConfirmation,
} from "./AccountCoverageConfirm";
import { Button, Modal, Tabs } from "./bits";

export interface ImportResult {
  imported: number;
  duplicates: number;
  needsReview: number;
  failures: string[];
  coverageCandidates?: AccountCoverageCandidate[];
}

type ImportMode = "statement" | "csv";

export function ImportModal({
  onImport,
  onCsv,
  onReview,
  onConfirmCoverage = () => undefined,
  onClose,
}: {
  onImport: (
    files: File[],
    passwords: Record<string, string>,
    onProgress: (step: string) => void,
  ) => Promise<ImportResult>;
  onCsv: (file: File) => void;
  onReview: () => void;
  onConfirmCoverage?: (confirmations: AccountCoverageConfirmation[]) => void;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<ImportMode>("statement");
  const [files, setFiles] = useState<File[]>([]);
  const [passwords, setPasswords] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState("");
  const [result, setResult] = useState<ImportResult | null>(null);
  const [selectionError, setSelectionError] = useState("");

  function chooseFiles(selected: File[]) {
    setResult(null);
    setSelectionError("");
    try {
      if (mode === "csv") {
        const csv = selected.find((file) => /\.csv$/i.test(file.name));
        if (csv) {
          assertCsvFile(csv);
          onCsv(csv);
        }
        return;
      }
      const statements = selected.filter((file) => /\.(html?|pdf)$/i.test(file.name));
      assertStatementFiles(statements);
      setFiles(statements);
    } catch (error) {
      setFiles([]);
      setSelectionError((error as Error).message);
    }
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
        <Tabs
          idPrefix="import"
          label="Import type"
          className="import-choice"
          value={mode}
          items={[
            {
              id: "statement",
              panelId: "import-panel-statement",
              label: <><Landmark size={18} aria-hidden="true" />Bank statement</>,
            },
            {
              id: "csv",
              panelId: "import-panel-csv",
              label: <><FileSpreadsheet size={18} aria-hidden="true" />CSV export</>,
            },
          ]}
          onChange={(nextMode) => {
            setMode(nextMode);
            setFiles([]);
            setResult(null);
            setSelectionError("");
          }}
        />

        <label
          className="dropzone"
          id={`import-panel-${mode}`}
          role="tabpanel"
          aria-labelledby={`import-tab-${mode}`}
        >
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

        {selectionError && <p className="notice" role="alert">{selectionError}</p>}

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

        {result?.coverageCandidates?.length ? (
          <AccountCoverageConfirm candidates={result.coverageCandidates} onConfirm={onConfirmCoverage} />
        ) : null}

        <div className="modal-actions">
          <Button variant="secondary" onClick={onClose} disabled={!!busy}>{result ? "Close" : "Cancel"}</Button>
          {result?.needsReview ? <Button variant="primary" onClick={onReview}>Review queue</Button> : null}
          {mode === "statement" && (!result || result.failures.length) ? (
            <Button variant="primary" onClick={run} disabled={!files.length || !!busy}>
              {busy || (result?.failures.length
                ? "Retry import"
                : `Import ${files.length} statement${files.length === 1 ? "" : "s"}`)}
            </Button>
          ) : null}
        </div>
      </div>
    </Modal>
  );
}
