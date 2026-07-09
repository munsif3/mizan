import { useMemo, useState } from "react";
import { parsersFor } from "../import/registry";
import type { StatementParser } from "../import/types";
import { Modal } from "./bits";

export interface ImportResult {
  imported: number;
  duplicates: number;
  needsReview: number;
  failures: string[];
}

export function ImportModal({
  onImport,
  onCsv,
  onClose,
}: {
  onImport: (
    files: File[],
    passwords: Record<string, string>,
    onProgress: (step: string) => void,
  ) => Promise<ImportResult>;
  onCsv: (file: File) => void;
  onClose: () => void;
}) {
  const [files, setFiles] = useState<File[]>([]);
  const [passwords, setPasswords] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState("");

  function chooseFiles(selected: File[]) {
    // CSV needs an interactive column-mapping step, so hand the first CSV off to
    // the dedicated modal; bank statements (HTML/PDF) go through the parser flow.
    const csv = selected.find((file) => /\.csv$/i.test(file.name));
    if (csv) {
      onCsv(csv);
      return;
    }
    setFiles(selected);
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
    setBusy("Reading statements");
    try {
      await onImport(files, passwords, setBusy);
      onClose();
    } finally {
      setBusy("");
    }
  }

  return (
    <Modal title="Import statements" onClose={() => !busy && onClose()}>
      <p className="muted">
        Upload an HTML or PDF bank statement, or a CSV export from any bank. Encrypted/password-protected files are
        unlocked in this browser — nothing leaves this device. New merchants land in the review queue for a one-tap
        category.
      </p>
      <label className="dropzone">
        <input
          type="file"
          accept=".html,.htm,.pdf,.csv"
          multiple
          onChange={(event) => chooseFiles(Array.from(event.target.files ?? []))}
        />
        <strong>{files.length ? `${files.length} file${files.length === 1 ? "" : "s"} selected` : "Choose statement or CSV files"}</strong>
        <span>
          {files.map((file) => file.name).join(", ") || "Duplicates are skipped by date, merchant, amount, and account."}
        </span>
      </label>
      {neededParsers.map((parser) => (
        <label className="field" key={parser.id}>
          <span>{parser.passwordLabel}</span>
          <input
            value={passwords[parser.id] ?? ""}
            onChange={(event) => setPasswords((previous) => ({ ...previous, [parser.id]: event.target.value }))}
            placeholder={parser.passwordPlaceholder}
          />
        </label>
      ))}
      <div className="modal-actions">
        <button className="secondary" onClick={onClose} disabled={!!busy}>Cancel</button>
        <button onClick={run} disabled={!files.length || !!busy}>{busy || "Import"}</button>
      </div>
    </Modal>
  );
}
