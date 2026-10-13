"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import clsx from "clsx";
import { AlertTriangle, CheckCircle2, Info, Loader2, X } from "lucide-react";

// ---------------------------------------------------------------- Toasts and confirm dialogs

type ToastKind = "success" | "error" | "info";
interface ToastItem {
  id: number;
  kind: ToastKind;
  message: string;
}

interface UiApi {
  toast: (kind: ToastKind, message: string) => void;
  confirm: (message: string, opts?: { title?: string; confirmLabel?: string; danger?: boolean }) => Promise<boolean>;
}

const UiCtx = createContext<UiApi | null>(null);
export const useUi = (): UiApi => {
  const v = useContext(UiCtx);
  if (!v) throw new Error("useUi outside provider");
  return v;
};

export function UiProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [dialog, setDialog] = useState<null | { message: string; title?: string; confirmLabel?: string; danger?: boolean; resolve: (v: boolean) => void }>(null);
  const counter = useRef(0);

  const toast = useCallback((kind: ToastKind, message: string) => {
    const id = ++counter.current;
    setToasts((t) => [...t, { id, kind, message }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === "error" ? 8000 : 4000);
  }, []);

  const confirm = useCallback<UiApi["confirm"]>((message, opts) => new Promise<boolean>((resolve) => setDialog({ message, ...opts, resolve })), []);

  const api = useMemo(() => ({ toast, confirm }), [toast, confirm]);
  return (
    <UiCtx.Provider value={api}>
      {children}
      <div className="no-print pointer-events-none fixed bottom-4 right-4 z-[100] flex w-[min(92vw,380px)] flex-col gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            role="status"
            className={clsx(
              "pointer-events-auto flex items-start gap-2 rounded-lg border px-3 py-2.5 text-sm shadow-pop",
              t.kind === "success" && "border-green-200 bg-green-50 text-green-900",
              t.kind === "error" && "border-red-200 bg-red-50 text-red-900",
              t.kind === "info" && "border-ink-200 bg-white text-ink-800",
            )}
          >
            {t.kind === "success" ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> : t.kind === "error" ? <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> : <Info className="mt-0.5 h-4 w-4 shrink-0" />}
            <span className="flex-1 whitespace-pre-line">{t.message}</span>
            <button className="opacity-60 hover:opacity-100" onClick={() => setToasts((x) => x.filter((y) => y.id !== t.id))} aria-label="Dismiss">
              <X className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>
      {dialog && (
        <Modal
          title={dialog.title ?? "Please confirm"}
          onClose={() => {
            dialog.resolve(false);
            setDialog(null);
          }}
          size="sm"
          footer={
            <>
              <Button
                onClick={() => {
                  dialog.resolve(false);
                  setDialog(null);
                }}
              >
                Cancel
              </Button>
              <Button
                variant={dialog.danger ? "danger" : "primary"}
                autoFocus
                onClick={() => {
                  dialog.resolve(true);
                  setDialog(null);
                }}
              >
                {dialog.confirmLabel ?? "Confirm"}
              </Button>
            </>
          }
        >
          <p className="whitespace-pre-line text-sm text-ink-700">{dialog.message}</p>
        </Modal>
      )}
    </UiCtx.Provider>
  );
}

// ---------------------------------------------------------------- Buttons and layout bits

type BtnVariant = "default" | "primary" | "danger" | "ghost";
export function Button({ variant = "default", size, busy, className, children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnVariant; size?: "sm"; busy?: boolean }) {
  return (
    <button
      type="button"
      {...rest}
      disabled={rest.disabled || busy}
      className={clsx("btn", variant === "primary" && "btn-primary", variant === "danger" && "btn-danger", variant === "ghost" && "btn-ghost", size === "sm" && "btn-sm", className)}
    >
      {busy && <Loader2 className="h-4 w-4 animate-spin" />}
      {children}
    </button>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 p-8 text-sm text-ink-500">
      <Loader2 className="h-4 w-4 animate-spin" />
      {label ?? "Loading"}
    </div>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold tracking-tight text-ink-900">{title}</h1>
        {subtitle && <p className="mt-0.5 max-w-3xl text-sm text-ink-500">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function EmptyState({ title, text, action, icon }: { title: string; text?: ReactNode; action?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-14 text-center">
      {icon && <div className="text-ink-300">{icon}</div>}
      <p className="text-sm font-semibold text-ink-800">{title}</p>
      {text && <p className="max-w-md text-sm text-ink-500">{text}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

const TONES = {
  gray: "bg-ink-100 text-ink-700",
  red: "bg-red-50 text-red-700",
  green: "bg-green-50 text-green-700",
  amber: "bg-amber-50 text-amber-800",
  blue: "bg-blue-50 text-blue-700",
  brand: "bg-brand-50 text-brand-700",
} as const;
export type Tone = keyof typeof TONES;
export function Badge({ tone = "gray", children }: { tone?: Tone; children: ReactNode }) {
  return <span className={clsx("badge", TONES[tone])}>{children}</span>;
}

export function Modal({ title, children, footer, onClose, size = "md" }: { title: string; children: ReactNode; footer?: ReactNode; onClose: () => void; size?: "sm" | "md" | "lg" | "xl" }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);
  const width = { sm: "max-w-md", md: "max-w-xl", lg: "max-w-3xl", xl: "max-w-5xl" }[size];
  return (
    <div className="no-print fixed inset-0 z-50 flex items-end justify-center bg-ink-900/40 p-0 sm:items-center sm:p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-label={title} className={clsx("flex max-h-[92vh] w-full flex-col rounded-t-2xl bg-white shadow-pop sm:rounded-2xl", width)}>
        <div className="flex items-center justify-between border-b border-ink-100 px-5 py-3">
          <h2 className="text-base font-semibold text-ink-900">{title}</h2>
          <button className="rounded-md p-1 text-ink-500 hover:bg-ink-100" onClick={onClose} aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-ink-100 px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}

export function Field({ label, children, hint, className }: { label: string; children: ReactNode; hint?: string; className?: string }) {
  return (
    <label className={clsx("block", className)}>
      <span className="label">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-ink-500">{hint}</span>}
    </label>
  );
}

export function Stat({ label, value, sub, tone, href }: { label: string; value: ReactNode; sub?: ReactNode; tone?: "red" | "amber" | "green"; href?: string }) {
  const body = (
    <div className={clsx("card h-full p-4 transition", href && "hover:border-brand-300 hover:shadow-pop")}>
      <p className="text-xs font-medium text-ink-500">{label}</p>
      <p className={clsx("mt-1 text-2xl font-semibold tabular-nums", tone === "red" && "text-red-600", tone === "amber" && "text-amber-600", tone === "green" && "text-green-700")}>{value}</p>
      {sub && <p className="mt-0.5 text-xs text-ink-500">{sub}</p>}
    </div>
  );
  return href ? <a href={href}>{body}</a> : body;
}

export function useDebounced<T>(value: T, ms = 200): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** Small persisted state for per-viewer conveniences (column choices, last tab). Never throws. */
export function useLocalPref<T>(key: string, initial: T): [T, (v: T) => void] {
  const [val, setVal] = useState<T>(initial);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(`fbm:${key}`);
      if (raw) setVal(JSON.parse(raw) as T);
    } catch {
      /* storage unavailable */
    }
  }, [key]);
  const set = useCallback(
    (v: T) => {
      setVal(v);
      try {
        localStorage.setItem(`fbm:${key}`, JSON.stringify(v));
      } catch {
        /* storage unavailable */
      }
    },
    [key],
  );
  return [val, set];
}

export function Popover({ trigger, children, align = "left", width = 260 }: { trigger: (open: boolean, toggle: () => void) => ReactNode; children: (close: () => void) => ReactNode; align?: "left" | "right"; width?: number }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return (
    <div className="relative inline-block" ref={ref}>
      {trigger(open, () => setOpen((o) => !o))}
      {open && (
        <div className={clsx("absolute z-40 mt-1 rounded-xl border border-ink-200 bg-white p-2 shadow-pop", align === "right" ? "right-0" : "left-0")} style={{ width }}>
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}
