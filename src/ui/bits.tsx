import type { ReactNode } from "react";

export function Modal({
  title,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <section className={`modal ${wide ? "wide" : ""}`} onMouseDown={(event) => event.stopPropagation()}>
        <header>
          <h2>{title}</h2>
          <button className="icon" onClick={onClose}>x</button>
        </header>
        {children}
      </section>
    </div>
  );
}

export function PersonPanel({
  name,
  paid,
  personal,
  color,
  money,
}: {
  name: string;
  paid: number;
  personal: number;
  color: string;
  money: (value: number) => string;
}) {
  return (
    <div className="person-panel" style={{ "--person": color } as React.CSSProperties}>
      <span className="soft-label">{name}</span>
      <h3>{money(paid)}</h3>
      <p>paid from {name}'s accounts this month.</p>
      <div className="person-row">
        <span>Personal spend</span>
        <strong>{money(personal)}</strong>
      </div>
    </div>
  );
}
