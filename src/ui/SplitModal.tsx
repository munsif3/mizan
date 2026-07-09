import { useState } from "react";
import type { Split, Transaction } from "../domain/types";
import { Modal } from "./bits";

export function SplitModal({
  txn,
  onSave,
  onClear,
  onClose,
}: {
  txn: Transaction;
  onSave: (id: string, split: Split) => void;
  onClear: (id: string) => void;
  onClose: () => void;
}) {
  const [of, setOf] = useState(String(txn.split?.of ?? 2));
  const [mine, setMine] = useState(String(txn.split?.mine ?? 1));

  function save() {
    const total = Math.max(2, Number(of) || 2);
    const share = Math.min(total, Math.max(1, Number(mine) || 1));
    onSave(txn.id, { mine: share, of: total });
    onClose();
  }

  return (
    <Modal title="Split transaction" onClose={onClose}>
      <p className="muted">{txn.description} — only your share counts toward the month.</p>
      <div className="form-grid">
        <label className="field"><span>Total parts</span><input type="number" min="2" value={of} onChange={(event) => setOf(event.target.value)} /></label>
        <label className="field"><span>Our parts</span><input type="number" min="1" value={mine} onChange={(event) => setMine(event.target.value)} /></label>
      </div>
      <div className="modal-actions">
        <button
          className="secondary"
          onClick={() => {
            onClear(txn.id);
            onClose();
          }}
        >
          Clear
        </button>
        <button onClick={save}>Save</button>
      </div>
    </Modal>
  );
}
