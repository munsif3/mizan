import { useEffect, useId, useRef, type ComponentType, type KeyboardEvent, type ReactNode } from "react";
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
  const titleId = useId();
  const panelRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const panel = panelRef.current;
    const focusable = panel?.querySelector<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
    );
    (focusable ?? panel)?.focus();
    return () => previousFocus?.focus();
  }, []);

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = [...(panelRef.current?.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
    ) ?? [])];
    if (!focusable.length) {
      event.preventDefault();
      panelRef.current?.focus();
      return;
    }
    const first = focusable[0]!;
    const last = focusable[focusable.length - 1]!;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section
        ref={panelRef}
        className={`modal ${wide ? "wide" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={onKeyDown}
      >
        <header>
          <h2 id={titleId}>{title}</h2>
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

/**
 * A money value that drills into the ledger when a target is available.
 *
 * The accessible label deliberately uses the formatted value rather than the
 * raw number, so privacy mode never leaks a hidden amount to assistive tech.
 */
export function DrilldownAmount({
  value,
  money,
  label,
  onClick,
  className = "",
}: {
  value: number;
  money: (value: number) => string;
  label: string;
  onClick?: () => void;
  className?: string;
}) {
  const formatted = money(value);
  if (!onClick) return <strong className={className}>{formatted}</strong>;

  return (
    <button
      type="button"
      className={`drilldown-amount ${className}`.trim()}
      aria-label={`${label}: ${formatted}. Open matching transactions`}
      onClick={onClick}
    >
      {formatted}
    </button>
  );
}
