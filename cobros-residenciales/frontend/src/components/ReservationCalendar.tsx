import { useCallback, useEffect, useMemo, useState } from "react";
import { backend } from "../lib/api";
import {
  addDays,
  overlaps,
  PARKING_HOURS,
  startOfWeekMonday,
  toISODate,
  WEEKDAY_SHORT,
} from "../lib/calendarUtils";
import Button from "./Button";

export type CalendarAmenityType = "visitor_parking" | "social_hall";

export type CalendarEvent = {
  reservation_id: string;
  amenity_id: string;
  amenity_code: string;
  amenity_type: CalendarAmenityType;
  start_at: string;
  end_at: string;
  status: string;
  user_id: string;
  user_name?: string | null;
  is_mine: boolean;
};

type CalendarAmenity = {
  _id: string;
  code: string;
  type: CalendarAmenityType;
  active: boolean;
};

type Props = {
  amenityType: CalendarAmenityType;
  mode: "resident" | "admin";
  title?: string;
  subtitle?: string;
  onSelectParking?: (amenityId: string, startLocal: string, endLocal: string) => void;
  onSelectHallDay?: (amenityId: string, dateISO: string) => void;
};

function formatLocalDateTime(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function eventAt(events: CalendarEvent[], amenityId: string, startMs: number, endMs: number): CalendarEvent | null {
  for (const e of events) {
    if (e.amenity_id !== amenityId) continue;
    const es = new Date(e.start_at).getTime();
    const ee = new Date(e.end_at).getTime();
    if (overlaps(startMs, endMs, es, ee)) return e;
  }
  return null;
}

function cellClass(ev: CalendarEvent | null, clickable: boolean): string {
  const base =
    "min-h-[2.25rem] rounded-lg border px-1 py-1 text-center text-[10px] font-medium leading-tight transition ";
  if (!ev) {
    return (
      base +
      (clickable
        ? "cursor-pointer border-emerald-300 bg-emerald-50 text-emerald-800 hover:bg-emerald-100 dark:border-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
        : "border-emerald-200/80 bg-emerald-50/80 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-400")
    );
  }
  if (ev.is_mine) {
    return (
      base +
      "border-violet-400 bg-violet-100 text-violet-900 dark:border-violet-600 dark:bg-violet-950/50 dark:text-violet-200"
    );
  }
  if (ev.status === "Pendiente") {
    return (
      base +
      "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200"
    );
  }
  return (
    base +
    "border-slate-300 bg-slate-100 text-slate-700 dark:border-app-border dark:bg-app-elevated dark:text-app-muted"
  );
}

export default function ReservationCalendar({
  amenityType,
  mode,
  title,
  subtitle,
  onSelectParking,
  onSelectHallDay,
}: Props) {
  const [weekStart, setWeekStart] = useState(() => startOfWeekMonday(new Date()));
  const [selectedDayIdx, setSelectedDayIdx] = useState(() => {
    const ws = startOfWeekMonday(new Date());
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const diff = Math.round((today.getTime() - ws.getTime()) / 86400000);
    return Math.min(6, Math.max(0, diff));
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [amenities, setAmenities] = useState<CalendarAmenity[]>([]);
  const [events, setEvents] = useState<CalendarEvent[]>([]);

  const weekDays = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)),
    [weekStart],
  );

  const rangeEnd = useMemo(() => addDays(weekStart, 7), [weekStart]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const from = weekStart.toISOString();
      const to = rangeEnd.toISOString();
      const r = await backend.get<{
        amenities: CalendarAmenity[];
        events: CalendarEvent[];
      }>("/reservations/calendar", {
        params: { from, to, type: amenityType },
      });
      setAmenities(r.data.amenities ?? []);
      setEvents(r.data.events ?? []);
    } catch (e: unknown) {
      const detail =
        e && typeof e === "object" && "response" in e
          ? (e as { response?: { data?: { detail?: string } } }).response?.data?.detail
          : undefined;
      setError(typeof detail === "string" ? detail : "No se pudo cargar el calendario.");
    } finally {
      setLoading(false);
    }
  }, [weekStart, rangeEnd, amenityType]);

  useEffect(() => {
    void load();
  }, [load]);

  const selectedDay = weekDays[selectedDayIdx] ?? weekDays[0];

  const defaultTitle =
    amenityType === "visitor_parking" ? "Calendario de parqueaderos" : "Calendario del salón comunal";
  const defaultSubtitle =
    mode === "admin"
      ? "Actividad de residentes por amenidad. En cada celda ocupada verás el nombre del residente."
      : "Verde = libre. Gris o ámbar = ocupado por otro. Violeta = tu reserva. Clic en «Libre» para reservar.";

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="text-base font-semibold text-app-text">{title ?? defaultTitle}</h3>
          <p className="mt-1 text-sm text-app-muted">{subtitle ?? defaultSubtitle}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="secondary"
            className="px-3 py-1.5 text-xs"
            onClick={() => setWeekStart((w) => addDays(w, -7))}
          >
            ← Semana anterior
          </Button>
          <Button
            type="button"
            variant="secondary"
            className="px-3 py-1.5 text-xs"
            onClick={() => {
              const ws = startOfWeekMonday(new Date());
              setWeekStart(ws);
              const today = new Date();
              today.setHours(0, 0, 0, 0);
              const diff = Math.round((today.getTime() - ws.getTime()) / 86400000);
              setSelectedDayIdx(Math.min(6, Math.max(0, diff)));
            }}
          >
            Hoy
          </Button>
          <Button
            type="button"
            variant="secondary"
            className="px-3 py-1.5 text-xs"
            onClick={() => setWeekStart((w) => addDays(w, 7))}
          >
            Semana siguiente →
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap gap-3 text-xs text-app-muted">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-3 w-6 rounded border border-emerald-300 bg-emerald-50 dark:bg-emerald-950/40" />
          Libre
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-3 w-6 rounded border border-slate-300 bg-slate-100 dark:bg-app-elevated" />
          Ocupado (pagada)
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-3 w-6 rounded border border-amber-300 bg-amber-50 dark:bg-amber-950/40" />
          Pendiente de pago
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-3 w-6 rounded border border-violet-400 bg-violet-100 dark:bg-violet-950/50" />
          {mode === "admin" ? "Residente (etiqueta en celda)" : "Tu reserva"}
        </span>
      </div>

      {error && (
        <div className="rounded-xl border border-app-danger-border bg-app-danger-bg px-3 py-2 text-sm text-app-danger-text">
          {error}
        </div>
      )}

      {loading && amenities.length === 0 ? (
        <div className="py-6 text-center text-sm text-app-muted">Cargando calendario…</div>
      ) : amenities.length === 0 ? (
        <div className="py-6 text-center text-sm text-app-muted">No hay amenidades activas de este tipo.</div>
      ) : amenityType === "visitor_parking" ? (
        <>
          <div className="flex flex-wrap gap-1">
            {weekDays.map((d, i) => (
              <button
                key={toISODate(d)}
                type="button"
                onClick={() => setSelectedDayIdx(i)}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                  selectedDayIdx === i
                    ? "bg-app-primary text-white"
                    : "border border-app-border bg-app-surface text-app-text hover:bg-app-elevated"
                }`}
              >
                {WEEKDAY_SHORT[i]} {d.getDate()}
              </button>
            ))}
          </div>
          <div className="overflow-x-auto rounded-xl border border-app-border">
            <table className="w-full min-w-[640px] border-collapse text-xs">
              <thead>
                <tr className="bg-app-elevated text-app-muted">
                  <th className="sticky left-0 z-[1] border-b border-app-border bg-app-elevated px-2 py-2 text-left">
                    Parqueadero
                  </th>
                  {PARKING_HOURS.map((h) => (
                    <th key={h} className="border-b border-app-border px-1 py-2 text-center font-normal">
                      {h}:00
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {amenities.map((a) => (
                  <tr key={a._id} className="border-t border-app-border">
                    <td className="sticky left-0 z-[1] border-r border-app-border bg-app-surface px-2 py-2 font-semibold text-app-text">
                      {a.code}
                    </td>
                    {PARKING_HOURS.map((h) => {
                      const slotStart = new Date(selectedDay);
                      slotStart.setHours(h, 0, 0, 0);
                      const slotEnd = new Date(selectedDay);
                      slotEnd.setHours(h + 1, 0, 0, 0);
                      const now = Date.now();
                      const past = slotEnd.getTime() <= now;
                      const ev = eventAt(events, a._id, slotStart.getTime(), slotEnd.getTime());
                      const free = !ev && !past;
                      const label = ev
                        ? ev.is_mine
                          ? mode === "admin"
                            ? ev.user_name ?? "Residente"
                            : "Tú"
                          : ev.user_name ?? "Ocupado"
                        : past
                          ? "—"
                          : "Libre";
                      return (
                        <td key={h} className="p-0.5">
                          <button
                            type="button"
                            disabled={!free || !onSelectParking}
                            title={ev ? `${ev.user_name ?? "Ocupado"} · ${ev.status}` : free ? "Disponible" : "Pasado"}
                            className={cellClass(ev, free && !!onSelectParking)}
                            onClick={() => {
                              if (!free || !onSelectParking) return;
                              onSelectParking(a._id, formatLocalDateTime(slotStart), formatLocalDateTime(slotEnd));
                            }}
                          >
                            {label}
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-app-muted">
            {onSelectParking
              ? "Haz clic en una celda verde «Libre» para rellenar el formulario de reserva."
              : "Vista de solo lectura."}
          </p>
        </>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-app-border">
          <table className="w-full min-w-[480px] border-collapse text-xs">
            <thead>
              <tr className="bg-app-elevated text-app-muted">
                <th className="sticky left-0 z-[1] border-b border-app-border bg-app-elevated px-2 py-2 text-left">
                  Salón
                </th>
                {weekDays.map((d, i) => (
                  <th key={toISODate(d)} className="border-b border-app-border px-1 py-2 text-center font-normal">
                    {WEEKDAY_SHORT[i]}
                    <br />
                    <span className="text-[10px]">{d.getDate()}/{d.getMonth() + 1}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {amenities.map((a) => (
                <tr key={a._id} className="border-t border-app-border">
                  <td className="sticky left-0 z-[1] border-r border-app-border bg-app-surface px-2 py-2 font-semibold text-app-text">
                    {a.code}
                  </td>
                  {weekDays.map((d) => {
                    const dayStart = new Date(d);
                    dayStart.setHours(0, 0, 0, 0);
                    const dayEnd = new Date(d);
                    dayEnd.setHours(23, 59, 59, 999);
                    const today = new Date();
                    today.setHours(0, 0, 0, 0);
                    const past = dayEnd.getTime() < today.getTime();
                    const ev = eventAt(events, a._id, dayStart.getTime(), dayEnd.getTime());
                    const free = !ev && !past;
                    const label = ev
                      ? ev.is_mine
                        ? mode === "admin"
                          ? `${ev.user_name ?? "Residente"}`
                          : "Tu día"
                        : (ev.user_name ?? "Ocupado")
                      : past
                        ? "—"
                        : "Libre";
                    return (
                      <td key={toISODate(d)} className="p-1">
                        <button
                          type="button"
                          disabled={!free || !onSelectHallDay}
                          title={ev ? `${ev.user_name} · ${ev.status}` : free ? "Día disponible" : "Pasado"}
                          className={`${cellClass(ev, free && !!onSelectHallDay)} min-h-[3rem] w-full`}
                          onClick={() => {
                            if (!free || !onSelectHallDay) return;
                            onSelectHallDay(a._id, toISODate(d));
                          }}
                        >
                          <span className="block">{label}</span>
                          {ev && mode === "admin" && (
                            <span className="mt-0.5 block text-[9px] font-normal opacity-80">{ev.status}</span>
                          )}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
