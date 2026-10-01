import { AlertTriangle, ClipboardList, Info, RotateCcw, X } from "lucide-react";
import { useEffect, useId, useState, type ReactNode } from "react";
import { errorMessage } from "@/api/client";
import { initials, statusClass, statusIcon } from "@/lib/format";

type Variant = "primary" | "secondary" | "quiet" | "danger";

export function Btn({
  children,
  variant = "primary",
  onClick,
  disabled,
  loading,
  className = "",
  type = "button",
  title,
  ariaLabel,
  form,
}: {
  children: ReactNode;
  variant?: Variant;
  onClick?: () => void;
  disabled?: boolean;
  loading?: boolean;
  className?: string;
  type?: "button" | "submit";
  title?: string;
  ariaLabel?: string;
  /** Id of a form elsewhere on the page that this submit button belongs to. */
  form?: string;
}) {
  return (
    <button
      type={type}
      form={form}
      disabled={disabled || loading}
      onClick={onClick}
      className={`btn btn-${variant} ${className}`}
      title={title}
      aria-label={ariaLabel}
      aria-busy={loading || undefined}
    >
      {loading && <Spinner light={variant === "primary"} />}
      {children}
    </button>
  );
}

export function Spinner({
  light = false,
  size = 12,
}: {
  light?: boolean;
  size?: number;
}) {
  return (
    <span
      aria-hidden="true"
      className={`inline-block animate-spin rounded-full border-2 ${light ? "border-white/40 border-t-white" : "border-[#cfe1dc] border-t-[#147f79]"}`}
      style={{ width: size, height: size }}
    />
  );
}

export function Status({ value, label }: { value: string; label?: string }) {
  return (
    <span className={`badge ${statusClass(value)}`}>
      <span aria-hidden="true">{statusIcon(value)}</span>
      {label ?? value}
    </span>
  );
}

export function Avatar({
  name,
  small = false,
}: {
  name: string;
  small?: boolean;
}) {
  return (
    <span
      className="avatar"
      style={small ? { width: 28, height: 28, fontSize: 9 } : undefined}
      aria-hidden="true"
    >
      {initials(name)}
    </span>
  );
}

export function SectionHeading({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="page-title serif">{title}</h1>
        {subtitle && <p className="page-subtitle">{subtitle}</p>}
      </div>
      {actions && (
        <div className="flex flex-wrap items-center gap-2">{actions}</div>
      )}
    </div>
  );
}

export function Panel({
  children,
  className = "",
  title,
  action,
}: {
  children: ReactNode;
  className?: string;
  title?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <section className={`panel ${className}`}>
      {(title || action) && (
        <div className="flex items-center justify-between gap-3 border-b border-[#e9eeec] px-5 py-4">
          <h2 className="panel-title">{title}</h2>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

export function EmptyState({
  title,
  text,
  action,
  icon,
}: {
  title: string;
  text: string;
  action?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="py-12 text-center">
      <div className="mx-auto mb-3 grid h-11 w-11 place-items-center rounded-full bg-[#eef5f3] text-[#397f78]">
        {icon ?? <ClipboardList size={19} />}
      </div>
      <div className="font-semibold text-[#364a56]">{title}</div>
      <p className="mt-1 text-xs text-[#7b8990]">{text}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function LoadingBlock({
  label = "Loading…",
  className = "",
}: {
  label?: string;
  className?: string;
}) {
  return (
    <div
      className={`flex items-center justify-center gap-2 py-12 text-xs text-[#72818a] ${className}`}
      role="status"
      aria-live="polite"
    >
      <Spinner size={14} />
      {label}
    </div>
  );
}

export function ErrorBlock({
  error,
  onRetry,
}: {
  error: unknown;
  onRetry?: () => void;
}) {
  return (
    <div
      role="alert"
      className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-[#f0d2d0] bg-[#fff2f0] p-4 text-xs text-[#9d4942]"
    >
      <span className="flex items-center gap-2">
        <AlertTriangle size={15} />
        {errorMessage(error)}
      </span>
      {onRetry && (
        <Btn variant="secondary" onClick={onRetry}>
          <RotateCcw size={13} />
          Try again
        </Btn>
      )}
    </div>
  );
}

export function FormAlert({ message }: { message?: string | null }) {
  if (!message) return null;
  return (
    <div
      role="alert"
      className="rounded-md border border-[#f0d2d0] bg-[#fff2f0] px-3 py-2.5 text-xs text-[#9d4942]"
    >
      {message}
    </div>
  );
}

export function InfoNote({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`rounded-md border border-[#d9e9e5] bg-[#f1f8f6] p-3 text-[11px] leading-5 text-[#496663] ${className}`}
    >
      <Info size={14} className="mr-1.5 inline" />
      {children}
    </div>
  );
}

export function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return <p className="mt-1 text-[11px] text-[#b9433e]">{message}</p>;
}

/** Locks page scroll and closes on Escape while an overlay is open. */
export function useOverlay(onClose: () => void, enabled = true) {
  useEffect(() => {
    if (!enabled) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose, enabled]);
}

export function Drawer({
  onClose,
  title,
  eyebrow,
  subtitle,
  wide = false,
  children,
  footer,
}: {
  onClose: () => void;
  title: ReactNode;
  eyebrow?: ReactNode;
  subtitle?: ReactNode;
  wide?: boolean;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const titleId = useId();
  useOverlay(onClose);
  return (
    <div className="fixed inset-0 z-[70]">
      <button
        className="app-drawer-backdrop"
        aria-label="Close panel"
        onClick={onClose}
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={`app-drawer-panel ${wide ? "app-drawer-panel--wide" : ""}`}
      >
        <header className="flex shrink-0 items-start justify-between gap-4 border-b border-[#e7ecea] bg-white px-5 py-4 sm:px-6">
          <div>
            {eyebrow && (
              <div className="text-[10px] uppercase tracking-[.14em] text-[#849198]">
                {eyebrow}
              </div>
            )}
            <h2 id={titleId} className="mt-1 font-semibold text-[#314753]">
              {title}
            </h2>
            {subtitle && (
              <p className="mt-1 text-[10px] text-[#87949a]">{subtitle}</p>
            )}
          </div>
          <button className="icon-btn" aria-label="Close" onClick={onClose}>
            <X size={17} />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
          {children}
        </div>
        {footer && (
          <footer className="shrink-0 border-t border-[#e7ecea] bg-white p-4">
            {footer}
          </footer>
        )}
      </aside>
    </div>
  );
}

export function Modal({
  onClose,
  title,
  subtitle,
  children,
  busy = false,
}: {
  onClose: () => void;
  title: ReactNode;
  subtitle?: ReactNode;
  children: ReactNode;
  busy?: boolean;
}) {
  const titleId = useId();
  useOverlay(() => {
    if (!busy) onClose();
  });
  return (
    <div className="modal-backdrop" onClick={() => !busy && onClose()}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={event => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[#e9eeec] px-5 py-4">
          <div>
            <h2 id={titleId} className="font-semibold text-[#344854]">
              {title}
            </h2>
            {subtitle && (
              <p className="mt-1 text-[10px] text-[#849198]">{subtitle}</p>
            )}
          </div>
          <button
            className="icon-btn"
            onClick={onClose}
            disabled={busy}
            aria-label="Close dialog"
          >
            <X size={16} />
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

export function ConfirmModal({
  title,
  body,
  confirmLabel,
  danger = false,
  busy = false,
  onConfirm,
  onClose,
}: {
  title: string;
  body: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Modal title={title} onClose={onClose} busy={busy}>
      <div className="text-xs leading-5 text-[#687982]">{body}</div>
      <div className="mt-5 flex justify-end gap-2">
        <Btn variant="secondary" onClick={onClose} disabled={busy}>
          Cancel
        </Btn>
        <Btn
          variant={danger ? "danger" : "primary"}
          onClick={onConfirm}
          loading={busy}
        >
          {confirmLabel}
        </Btn>
      </div>
    </Modal>
  );
}

/** Debounces a changing value (search boxes, live validation). */
export function useDebounced<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}
