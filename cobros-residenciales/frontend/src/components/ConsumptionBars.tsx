import { useMemo, useState, type ReactNode } from "react";
import Card from "./Card";

export type ConsumptionItem = {
  /** Identificador estable (ej. "invoices", "parking", "hall", "gym"). */
  key: string;
  /** Etiqueta visible. */
  label: string;
  /** Monto agregado en COP (pagado o pendiente, según contexto). */
  amount: number;
  /** Cantidad de ítems (facturas, reservas, suscripciones…). */
  count: number;
  /** Color de la barra (clases tailwind para gradiente). */
  color: string;
  /** Ícono SVG opcional. */
  icon?: ReactNode;
};

type Props = {
  title: string;
  subtitle?: string;
  items: ConsumptionItem[];
  /** Etiqueta del total agregado. */
  totalLabel?: string;
  /** Click sobre una barra (para navegar a la sección correspondiente). */
  onSelect?: (key: string) => void;
  /** Mensaje cuando todo está en 0. */
  emptyLabel?: string;
};

function formatCOP(n: number): string {
  return `$${Math.round(n).toLocaleString("es-CO")}`;
}

/**
 * Barras horizontales animadas con tooltip al hacer hover.
 * - Cada barra es proporcional al valor máximo del set.
 * - Si todas las amounts son 0, muestra una pista discreta.
 * - Si `onSelect` viene definido, las barras son clickables (cursor pointer + keyboard).
 */
export default function ConsumptionBars({
  title,
  subtitle,
  items,
  totalLabel = "Total",
  onSelect,
  emptyLabel = "Aún no hay consumo registrado.",
}: Props) {
  const [hoverKey, setHoverKey] = useState<string | null>(null);

  const total = useMemo(() => items.reduce((acc, it) => acc + Math.max(0, it.amount), 0), [items]);
  const max = useMemo(() => Math.max(0, ...items.map((it) => it.amount)), [items]);
  const allZero = max <= 0;

  return (
    <Card>
      <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="text-base font-semibold text-app-text">{title}</div>
          {subtitle && <div className="mt-1 text-xs text-app-muted">{subtitle}</div>}
        </div>
        <div className="text-right">
          <div className="text-xs uppercase tracking-wide text-app-muted">{totalLabel}</div>
          <div className="text-xl font-bold text-app-text">{formatCOP(total)}</div>
        </div>
      </div>

      <div className="mt-5 space-y-3">
        {items.map((it) => {
          const pct = max > 0 ? Math.max((it.amount / max) * 100, it.amount > 0 ? 6 : 0) : 0;
          const sharePct = total > 0 ? (it.amount / total) * 100 : 0;
          const isClickable = Boolean(onSelect);
          const isHover = hoverKey === it.key;
          return (
            <div
              key={it.key}
              role={isClickable ? "button" : undefined}
              tabIndex={isClickable ? 0 : undefined}
              onClick={isClickable ? () => onSelect?.(it.key) : undefined}
              onKeyDown={
                isClickable
                  ? (e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        onSelect?.(it.key);
                      }
                    }
                  : undefined
              }
              onMouseEnter={() => setHoverKey(it.key)}
              onMouseLeave={() => setHoverKey((k) => (k === it.key ? null : k))}
              onFocus={() => setHoverKey(it.key)}
              onBlur={() => setHoverKey((k) => (k === it.key ? null : k))}
              className={`group relative rounded-xl border border-app-border bg-app-elevated p-3 transition ${
                isClickable ? "cursor-pointer hover:border-app-primary/60 focus:border-app-primary focus:outline-none" : ""
              }`}
              aria-label={`${it.label}: ${formatCOP(it.amount)} (${it.count} ítems)`}
            >
              <div className="mb-2 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-sm font-medium text-app-text">
                  {it.icon && (
                    <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-app-surface text-app-primary">
                      {it.icon}
                    </span>
                  )}
                  <span>{it.label}</span>
                  <span className="rounded-full bg-app-surface px-2 py-0.5 text-[11px] font-semibold text-app-muted">
                    {it.count}
                  </span>
                </div>
                <div className="flex items-baseline gap-2">
                  <span className="text-sm font-bold text-app-text">{formatCOP(it.amount)}</span>
                  {total > 0 && (
                    <span className="text-[11px] font-medium text-app-muted">
                      {sharePct.toFixed(0)}%
                    </span>
                  )}
                </div>
              </div>
              <div className="relative h-3 w-full overflow-hidden rounded-full bg-app-surface">
                <div
                  className={`h-full rounded-full transition-[width] duration-700 ease-out ${it.color}`}
                  style={{ width: `${pct}%` }}
                />
              </div>
              {isHover && it.amount > 0 && (
                <div className="pointer-events-none absolute -top-2 right-3 z-10 -translate-y-full rounded-lg bg-app-text px-3 py-1.5 text-[11px] font-medium text-app-bg shadow-lg">
                  {it.count} {it.count === 1 ? "ítem" : "ítems"} · {formatCOP(it.amount)}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {allZero && (
        <div className="mt-4 rounded-xl border border-dashed border-app-border bg-app-elevated px-4 py-3 text-xs text-app-muted">
          {emptyLabel}
        </div>
      )}
    </Card>
  );
}

/* ---- Íconos chiquitos para las barras ---- */
export function IconBarInvoice() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3z" />
      <path d="M9 8h6M9 12h6M9 16h4" />
    </svg>
  );
}
export function IconBarCar() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 14l1.5-4.5A2 2 0 016.4 8h11.2a2 2 0 011.9 1.5L21 14v5h-3v-2H6v2H3v-5z" />
      <circle cx="7.5" cy="16.5" r="1.2" />
      <circle cx="16.5" cy="16.5" r="1.2" />
    </svg>
  );
}
export function IconBarHall() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 11l9-7 9 7v10H3z" />
      <path d="M9 21v-6h6v6" />
    </svg>
  );
}
export function IconBarGym() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 12h2M20 12h2M6 7v10M18 7v10M6 12h12" />
    </svg>
  );
}
