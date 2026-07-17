import {
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type ComponentType,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { ChevronDown, X } from "lucide-react";

export const PRIVATE_FINANCIAL_VALUE = "••••";

export type DialogVariant = "modal" | "drawer";
export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "default" | "compact";

export function Button({
  variant,
  size = "default",
  className = "",
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant: ButtonVariant;
  size?: ButtonSize;
}) {
  return (
    <button
      {...props}
      type={type}
      className={`button button-${variant} button-${size} ${className}`.trim()}
    />
  );
}

export interface TabItem<T extends string> {
  id: T;
  label: ReactNode;
  panelId: string;
}

export function Tabs<T extends string>({
  idPrefix,
  label,
  items,
  value,
  onChange,
  orientation = "horizontal",
  className = "",
}: {
  idPrefix: string;
  label: string;
  items: TabItem<T>[];
  value: T;
  onChange: (value: T) => void;
  orientation?: "horizontal" | "vertical";
  className?: string;
}) {
  const buttonRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const selectAndFocus = (item: TabItem<T>) => {
    onChange(item.id);
    requestAnimationFrame(() => buttonRefs.current[item.id]?.focus());
  };

  return (
    <div className={`tabs ${className}`.trim()} role="tablist" aria-label={label} aria-orientation={orientation}>
      {items.map((item, index) => {
        const selected = item.id === value;
        return (
          <button
            key={item.id}
            ref={(node) => { buttonRefs.current[item.id] = node; }}
            type="button"
            id={`${idPrefix}-tab-${item.id}`}
            className={`tab-button ${selected ? "active" : ""}`.trim()}
            role="tab"
            aria-selected={selected}
            aria-controls={item.panelId}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(item.id)}
            onKeyDown={(event) => {
              if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
              event.preventDefault();
              const nextIndex = event.key === "Home"
                ? 0
                : event.key === "End"
                  ? items.length - 1
                  : (index + (event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
              const next = items[nextIndex];
              if (next) selectAndFocus(next);
            }}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}

export function Modal({
  title,
  children,
  onClose,
  wide = false,
  variant = "modal",
  meta,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
  variant?: DialogVariant;
  meta?: ReactNode;
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
    <div className={`modal-backdrop ${variant === "drawer" ? "drawer-backdrop" : ""}`} onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section
        ref={panelRef}
        className={`modal ${wide ? "wide" : ""} ${variant === "drawer" ? "drawer" : ""}`.trim()}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={onKeyDown}
      >
        <header>
          <div className="dialog-title">
            <h2 id={titleId}>{title}</h2>
            {meta && <div className="dialog-meta">{meta}</div>}
          </div>
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
        <h1>{title}</h1>
        <span>{description}</span>
        {context && <div className="page-context">{context}</div>}
      </div>
      <div className="page-actions" aria-label={`${title} actions`}>
        {actions}
      </div>
    </header>
  );
}

export function StatusBadge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "success" | "warning" | "danger" | "info";
}) {
  return <span className={`status-badge ${tone}`}>{children}</span>;
}

export function Alert({
  children,
  tone = "info",
  live = false,
  className = "",
}: {
  children: ReactNode;
  tone?: "info" | "success" | "warning" | "danger";
  live?: boolean;
  className?: string;
}) {
  return (
    <div
      className={`alert ${tone} ${className}`.trim()}
      role={tone === "danger" ? "alert" : live ? "status" : undefined}
      aria-live={live && tone !== "danger" ? "polite" : undefined}
    >
      {children}
    </div>
  );
}

export function EmptyState({
  eyebrow,
  title,
  children,
  action,
  compact = false,
}: {
  eyebrow: string;
  title: string;
  children: ReactNode;
  action?: ReactNode;
  compact?: boolean;
}) {
  return (
    <div className={`empty-state ${compact ? "compact" : ""}`}>
      <span className="soft-label">{eyebrow}</span>
      <h3>{title}</h3>
      <div className="empty-state-copy">{children}</div>
      {action && <div className="empty-state-action">{action}</div>}
    </div>
  );
}

export function Skeleton({ label = "Loading" }: { label?: string }) {
  return (
    <div className="skeleton" role="status" aria-label={label}>
      <span />
      <span />
      <span />
    </div>
  );
}

export function Disclosure({
  title,
  summary,
  children,
  defaultOpen = false,
  count,
}: {
  title: string;
  summary?: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
  count?: number;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const panelId = useId();
  return (
    <section className={`disclosure ${open ? "open" : ""}`}>
      <button
        type="button"
        className="disclosure-trigger"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((current) => !current)}
      >
        <span>
          <strong>{title}</strong>
          {summary && <small>{summary}</small>}
        </span>
        <span className="disclosure-trailing">
          {typeof count === "number" && <span className="disclosure-count">{count}</span>}
          <ChevronDown size={20} aria-hidden="true" />
        </span>
      </button>
      {open && <div className="disclosure-panel" id={panelId}>{children}</div>}
    </section>
  );
}

export function MoneyValue({
  formatted,
  hidden = false,
  className = "",
}: {
  formatted: string;
  hidden?: boolean;
  className?: string;
}) {
  return (
    <span className={`money-value ${hidden ? "masked" : ""} ${className}`.trim()} aria-label={hidden ? "Financial value hidden" : undefined}>
      {hidden ? PRIVATE_FINANCIAL_VALUE : formatted}
    </span>
  );
}

export function ConfirmDialog({
  title,
  children,
  confirmLabel,
  onConfirm,
  onClose,
  danger = true,
}: {
  title: string;
  children: ReactNode;
  confirmLabel: string;
  onConfirm: () => void;
  onClose: () => void;
  danger?: boolean;
}) {
  return (
    <Modal title={title} onClose={onClose}>
      <div className="confirm-dialog">
        <div className="alert warning">{children}</div>
        <div className="modal-actions">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button variant={danger ? "danger" : "primary"} onClick={onConfirm}>{confirmLabel}</Button>
        </div>
      </div>
    </Modal>
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
  const hidden = formatted === PRIVATE_FINANCIAL_VALUE;
  if (!onClick) return <strong className={className}>{formatted}</strong>;

  return (
    <button
      type="button"
      className={`drilldown-amount ${className}`.trim()}
      aria-label={hidden ? `${label}: financial value hidden. Open matching transactions` : `${label}: ${formatted}. Open matching transactions`}
      onClick={onClick}
    >
      {formatted}
    </button>
  );
}
