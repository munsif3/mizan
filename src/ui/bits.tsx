import type { ComponentType, ReactNode } from "react";
import { X } from "lucide-react";

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
          <IconButton label={`Close ${title}`} icon={X} onClick={onClose} />
        </header>
        {children}
      </section>
    </div>
  );
}

export function IconButton({
  label,
  icon: Icon,
  onClick,
  disabled = false,
  danger = false,
  title,
}: {
  label: string;
  icon: ComponentType<{ size?: number; strokeWidth?: number }>;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      className={`icon-btn ${danger ? "danger" : ""}`}
      aria-label={label}
      title={title ?? label}
      disabled={disabled}
      onClick={onClick}
    >
      <Icon size={17} strokeWidth={2.2} aria-hidden="true" />
    </button>
  );
}

export function PageHeader({
  eyebrow,
  title,
  description,
  context,
  actions,
}: {
  eyebrow: string;
  title: string;
  description: string;
  context?: ReactNode;
  actions: ReactNode;
}) {
  return (
    <header className="page-header">
      <div className="title-lockup">
        <p className="eyebrow">{eyebrow}</p>
        <h2>{title}</h2>
        <span>{description}</span>
        {context && <div className="page-context">{context}</div>}
      </div>
      <div className="page-actions" aria-label={`${title} actions`}>
        {actions}
      </div>
    </header>
  );
}

export function StatusStrip({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <section className="status-strip" aria-label="Current month status">
      <div className="shell-inner status-strip-inner">{children}</div>
    </section>
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
