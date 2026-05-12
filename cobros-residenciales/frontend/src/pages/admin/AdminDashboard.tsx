import { useEffect, useMemo, useState } from "react";
import Button from "../../components/Button";
import Card from "../../components/Card";
import ConsumptionBars, {
  IconBarCar,
  IconBarGym,
  IconBarHall,
  IconBarInvoice,
  type ConsumptionItem,
} from "../../components/ConsumptionBars";
import { backend } from "../../lib/api";
import { useSection, type AdminSection } from "../../lib/section";

type Dashboard = {
  total_recaudado_cop: number;
  facturas: { pendientes: number; vencidas: number; pagadas: number };
};

type Unit = { _id: string; code: string; coefficient: number; resident_user_id?: string | null };
type Invoice = {
  _id: string;
  unit_id: string;
  period: string;
  amount_cop: number;
  status: string;
  due_date: string;
  pdf_url?: string | null;
  xml_url?: string | null;
  factus_error?: string | null;
  factus_invoice_id?: string | null;
};
type User = { _id: string; email: string; full_name: string; role: "admin" | "resident"; tax_profile?: any | null };
type MorosidadRow = {
  unit_id: string;
  unit_code?: string | null;
  resident_email?: string | null;
  overdue_count: number;
  overdue_amount_cop: number;
  last_due_date?: string | null;
};

type Section = AdminSection;

type Amenity = {
  _id: string;
  type: "visitor_parking" | "social_hall";
  code: string;
  active: boolean;
};

type Reservation = {
  _id: string;
  amenity_id: string;
  amenity_type: "visitor_parking" | "social_hall";
  amenity_code: string;
  user_id: string;
  access_pin?: string | null;
  start_at: string;
  end_at: string;
  amount_cop: number;
  status: "Pendiente" | "Pagada" | "Cancelada";
  paid_at?: string | null;
};

type GymSubscription = {
  _id: string;
  user_id: string;
  period: string;
  amount_cop: number;
  status: "Pendiente" | "Pagada";
  paid_at?: string | null;
};

/**
 * Chart palette — read live from CSS variables so it follows light/dark theme.
 * The values are defined in `src/styles.css` under :root and html.dark.
 */
const CHART_CYAN = "rgb(var(--chart-primary))";
const CHART_AMBER = "rgb(var(--chart-warning))";
const CHART_EMERALD = "rgb(var(--chart-success))";

function MiniChart({
  title,
  subtitle,
  items,
}: {
  title: string;
  subtitle?: string;
  items: Array<{ label: string; value: number; fill: string }>;
}) {
  const maxValue = Math.max(0, ...items.map((i) => i.value));
  const scaleMax = Math.max(maxValue, 1);
  const vbW = 360;
  const vbH = 178;
  const padL = 8;
  const padR = 8;
  const padB = 44;
  const padT = 12;
  const innerW = vbW - padL - padR;
  const innerH = vbH - padT - padB;
  const gap = 10;
  const n = Math.max(1, items.length);
  const barW = (innerW - gap * (n - 1)) / n;

  return (
    <div className="space-y-3">
      <div>
        <div className="text-sm font-semibold text-app-text">{title}</div>
        {subtitle && <div className="mt-1 text-xs text-app-muted">{subtitle}</div>}
      </div>

      <div className="rounded-xl border border-app-border bg-app-elevated p-3">
        <svg
          viewBox={`0 0 ${vbW} ${vbH}`}
          width="100%"
          height={200}
          role="img"
          aria-label={title}
          className="block"
        >
          <rect x="0" y="0" width={vbW} height={vbH} fill="transparent" />

          {items.map((it, idx) => {
            const x = padL + idx * (barW + gap);
            const rawH = scaleMax <= 0 ? 0 : (it.value / scaleMax) * innerH;
            // Si todo es 0, mostramos “tacos” tenues para que la gráfica no desaparezca.
            const h = it.value <= 0 && maxValue <= 0 ? Math.max(innerH * 0.08, 6) : Math.max(rawH, it.value > 0 ? 8 : 0);
            const y = padT + innerH - h;
            return (
              <g key={it.label}>
                <rect
                  x={x}
                  y={y}
                  width={barW}
                  height={h}
                  rx={6}
                  fill={it.fill}
                  opacity={it.value <= 0 && maxValue <= 0 ? 0.25 : 0.95}
                />
                <text
                  x={x + barW / 2}
                  y={padT + innerH + 18}
                  textAnchor="middle"
                  style={{ fill: "rgb(var(--app-muted))" }}
                  fontSize="11"
                >
                  {it.label}
                </text>
                <text
                  x={x + barW / 2}
                  y={padT + innerH + 30}
                  textAnchor="middle"
                  style={{ fill: "rgb(var(--app-text))" }}
                  fontSize="12"
                  fontWeight="700"
                >
                  {it.value}
                </text>
              </g>
            );
          })}
        </svg>

        {maxValue <= 0 && (
          <div className="mt-2 rounded-lg border border-app-border bg-app-elevated px-3 py-2 text-xs text-app-muted">
            Aún no hay datos numéricos para comparar (valores en 0). Cuando existan registros, las barras reflejarán el
            tamaño relativo.
          </div>
        )}
      </div>
    </div>
  );
}

export default function AdminDashboard() {
  const [dash, setDash] = useState<Dashboard | null>(null);
  const [units, setUnits] = useState<Unit[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [residents, setResidents] = useState<User[]>([]);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [showNewUnit, setShowNewUnit] = useState(false);
  const [newUnitCode, setNewUnitCode] = useState("");
  const [newUnitCoeff, setNewUnitCoeff] = useState("");
  const [showResidents, setShowResidents] = useState(false);
  const [newResidentName, setNewResidentName] = useState("");
  const [newResidentEmail, setNewResidentEmail] = useState("");
  const [newResidentPassword, setNewResidentPassword] = useState("");
  const [editingResidentId, setEditingResidentId] = useState<string | null>(null);
  const [editResidentName, setEditResidentName] = useState("");
  const [editResidentEmail, setEditResidentEmail] = useState("");
  const [resetPwdResidentId, setResetPwdResidentId] = useState<string | null>(null);
  const [resetPwdValue, setResetPwdValue] = useState("");
  const [editingTaxResidentId, setEditingTaxResidentId] = useState<string | null>(null);
  const [taxJson, setTaxJson] = useState("");

  const [editingUnitId, setEditingUnitId] = useState<string | null>(null);
  const [editUnitCode, setEditUnitCode] = useState("");
  const [editUnitCoeff, setEditUnitCoeff] = useState("");
  const [invoiceStatus, setInvoiceStatus] = useState<string>("");
  const [invoicePeriod, setInvoicePeriod] = useState<string>("");
  const [showMorosidad, setShowMorosidad] = useState(false);
  const [morosidad, setMorosidad] = useState<MorosidadRow[]>([]);
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);
  /** Filtros ya confirmados con «Aplicar filtros» (el catálogo completo va en `invoices`). */
  const [appliedInvoiceStatus, setAppliedInvoiceStatus] = useState("");
  const [appliedInvoicePeriod, setAppliedInvoicePeriod] = useState("");
  const [invoiceFilterError, setInvoiceFilterError] = useState<string | null>(null);
  /** Sección activa controlada desde el sidebar (vía SectionContext). */
  const { section: sectionRaw, setSection: setSectionRaw } = useSection();
  const section = sectionRaw as Section;
  const setSection = (s: Section) => setSectionRaw(s);

  const [amenities, setAmenities] = useState<Amenity[]>([]);
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [gymSubs, setGymSubs] = useState<GymSubscription[]>([]);
  const [newAmenityType, setNewAmenityType] = useState<"visitor_parking" | "social_hall">("visitor_parking");
  const [newAmenityCode, setNewAmenityCode] = useState("");
  const [resStatusFilter, setResStatusFilter] = useState<string>("");
  const [resTypeFilter, setResTypeFilter] = useState<string>("");
  const [gymPeriodFilter, setGymPeriodFilter] = useState<string>("");
  /**
   * `busyId` identifica la fila puntual en operación (ej. una amenidad o reserva).
   * Permite deshabilitar solo el botón pulsado sin bloquear toda la UI con `creating`.
   */
  const [busyId, setBusyId] = useState<string | null>(null);

  function formatApiDetail(detail: unknown): string {
    if (typeof detail === "string") return detail;
    if (Array.isArray(detail))
      return detail.map((x: { msg?: string }) => x?.msg ?? JSON.stringify(x)).join(" ");
    return "No se pudo completar la solicitud.";
  }

  /** El API puede devolver `status` como string o en edge cases distinto casing / espacios. */
  function rowStatusNorm(i: Invoice): string {
    const raw = i.status as unknown;
    if (typeof raw === "string") return raw.trim().toLowerCase();
    if (raw && typeof raw === "object" && "value" in (raw as object))
      return String((raw as { value?: string }).value ?? "").trim().toLowerCase();
    return String(raw ?? "").trim().toLowerCase();
  }

  function rowPeriodNorm(i: Invoice): string {
    return String(i.period ?? "")
      .trim()
      .slice(0, 10);
  }

  const visibleInvoices = useMemo(() => {
    const wantStatus = appliedInvoiceStatus.trim().toLowerCase();
    const wantPeriod = appliedInvoicePeriod.trim();
    return invoices.filter((i) => {
      if (wantStatus && rowStatusNorm(i) !== wantStatus) return false;
      if (wantPeriod && rowPeriodNorm(i) !== wantPeriod) return false;
      return true;
    });
  }, [invoices, appliedInvoiceStatus, appliedInvoicePeriod]);

  /** Permite pasar status/periodo explícitos al cambiar el select antes del siguiente render. */
  function commitInvoiceFilters(effective?: { status?: string; period?: string }) {
    const st = effective?.status !== undefined ? effective.status : invoiceStatus;
    const rawPeriod = effective?.period !== undefined ? effective.period : invoicePeriod;
    const p = rawPeriod.trim();
    if (p && !/^\d{4}-\d{2}$/.test(p)) {
      setInvoiceFilterError("Periodo inválido. Usa YYYY-MM (ej. 2026-04).");
      return;
    }
    setInvoiceFilterError(null);
    setError(null);
    setAppliedInvoiceStatus(st.trim());
    setAppliedInvoicePeriod(p);
  }

  async function refresh() {
    setError(null);
    setInvoiceFilterError(null);
    try {
      const [d, u, inv, r, am, res, gym] = await Promise.all([
        backend.get("/reports/dashboard"),
        backend.get("/units"),
        backend.get("/invoices"),
        backend.get("/admin/users", { params: { role: "resident" } }),
        backend.get("/amenities"),
        backend.get("/reservations"),
        backend.get("/gym/subscriptions"),
      ]);
      setDash(d.data);
      setUnits(u.data);
      setInvoices(Array.isArray(inv.data) ? inv.data : []);
      setResidents(r.data);
      setAmenities(Array.isArray(am.data) ? am.data : []);
      setReservations(Array.isArray(res.data) ? res.data : []);
      setGymSubs(Array.isArray(gym.data) ? gym.data : []);
    } catch (e: any) {
      const msg = formatApiDetail(e?.response?.data?.detail);
      setError(msg);
    }
  }

  /**
   * Refrescos selectivos: solo recargan la colección modificada,
   * para evitar disparar 7 GETs por cada acción y que la UI se sienta congelada.
   */
  async function refreshAmenities() {
    try {
      const r = await backend.get("/amenities");
      setAmenities(Array.isArray(r.data) ? r.data : []);
    } catch (e: any) {
      setError(formatApiDetail(e?.response?.data?.detail));
    }
  }

  async function refreshReservations() {
    try {
      const r = await backend.get("/reservations");
      setReservations(Array.isArray(r.data) ? r.data : []);
    } catch (e: any) {
      setError(formatApiDetail(e?.response?.data?.detail));
    }
  }

  async function refreshGymSubs() {
    try {
      const r = await backend.get("/gym/subscriptions");
      setGymSubs(Array.isArray(r.data) ? r.data : []);
    } catch (e: any) {
      setError(formatApiDetail(e?.response?.data?.detail));
    }
  }

  async function createAmenity() {
    const code = newAmenityCode.trim().toUpperCase();
    if (!code) {
      setError("Debes ingresar el código de la amenidad.");
      return;
    }
    setCreating(true);
    setError(null);
    setInfo(null);
    try {
      await backend.post("/amenities", { type: newAmenityType, code, active: true });
      setInfo(`Amenidad creada: ${code}`);
      setNewAmenityCode("");
      await refreshAmenities();
    } catch (e: any) {
      setError(e?.response?.data?.detail ?? "No se pudo crear la amenidad");
    } finally {
      setCreating(false);
    }
  }

  async function toggleAmenity(a: Amenity) {
    if (busyId) return;
    setBusyId(a._id);
    setError(null);
    setInfo(null);
    try {
      await backend.patch(`/amenities/${a._id}`, { active: !a.active });
      await refreshAmenities();
    } catch (e: any) {
      setError(e?.response?.data?.detail ?? "No se pudo actualizar la amenidad");
    } finally {
      setBusyId(null);
    }
  }

  async function deleteAmenity(id: string) {
    if (busyId) return;
    if (!confirm("¿Eliminar amenidad? Se borran sus reservas no pagadas.")) return;
    setBusyId(id);
    setError(null);
    setInfo(null);
    try {
      await backend.delete(`/amenities/${id}`);
      setInfo("Amenidad eliminada.");
      await Promise.all([refreshAmenities(), refreshReservations()]);
    } catch (e: any) {
      setError(e?.response?.data?.detail ?? "No se pudo eliminar la amenidad");
    } finally {
      setBusyId(null);
    }
  }

  async function cancelReservation(id: string) {
    if (busyId) return;
    if (!confirm("¿Cancelar reserva?")) return;
    setBusyId(id);
    setError(null);
    setInfo(null);
    try {
      await backend.post(`/reservations/${id}/cancel`);
      setInfo("Reserva cancelada.");
      await refreshReservations();
    } catch (e: any) {
      setError(e?.response?.data?.detail ?? "No se pudo cancelar");
    } finally {
      setBusyId(null);
    }
  }

  async function deleteReservation(id: string) {
    if (busyId) return;
    if (!confirm("¿Eliminar reserva definitivamente?")) return;
    setBusyId(id);
    setError(null);
    setInfo(null);
    try {
      await backend.delete(`/reservations/${id}`);
      setInfo("Reserva eliminada.");
      await refreshReservations();
    } catch (e: any) {
      setError(e?.response?.data?.detail ?? "No se pudo eliminar");
    } finally {
      setBusyId(null);
    }
  }

  async function deleteGymSub(id: string) {
    if (busyId) return;
    if (!confirm("¿Eliminar suscripción de gimnasio?")) return;
    setBusyId(id);
    setError(null);
    setInfo(null);
    try {
      await backend.delete(`/gym/subscriptions/${id}`);
      setInfo("Suscripción eliminada.");
      await refreshGymSubs();
    } catch (e: any) {
      setError(e?.response?.data?.detail ?? "No se pudo eliminar");
    } finally {
      setBusyId(null);
    }
  }

  const visibleReservations = useMemo(() => {
    return reservations.filter((r) => {
      if (resStatusFilter && r.status !== resStatusFilter) return false;
      if (resTypeFilter && r.amenity_type !== resTypeFilter) return false;
      return true;
    });
  }, [reservations, resStatusFilter, resTypeFilter]);

  const visibleGymSubs = useMemo(() => {
    return gymSubs.filter((s) => (gymPeriodFilter ? s.period === gymPeriodFilter : true));
  }, [gymSubs, gymPeriodFilter]);

  /**
   * Recaudo agregado por categoría (suma de los pagados). Sirve para las barras
   * interactivas que el admin ve en su panel.
   */
  const adminConsumption: ConsumptionItem[] = useMemo(() => {
    const paidInvoices = invoices.filter((i) => String(i.status ?? "").toLowerCase() === "pagada");
    const paidParking = reservations.filter(
      (r) => r.amenity_type === "visitor_parking" && r.status === "Pagada",
    );
    const paidHall = reservations.filter(
      (r) => r.amenity_type === "social_hall" && r.status === "Pagada",
    );
    const paidGym = gymSubs.filter((s) => s.status === "Pagada");
    const sum = <T extends { amount_cop: number }>(arr: T[]) =>
      arr.reduce((acc, x) => acc + (Number(x.amount_cop) || 0), 0);
    return [
      {
        key: "facturas",
        label: "Administración",
        amount: sum(paidInvoices),
        count: paidInvoices.length,
        color: "bg-gradient-to-r from-violet-500 to-indigo-500",
        icon: <IconBarInvoice />,
      },
      {
        key: "reservas-parking",
        label: "Parqueadero",
        amount: sum(paidParking),
        count: paidParking.length,
        color: "bg-gradient-to-r from-sky-500 to-cyan-400",
        icon: <IconBarCar />,
      },
      {
        key: "reservas-salon",
        label: "Salón comunal",
        amount: sum(paidHall),
        count: paidHall.length,
        color: "bg-gradient-to-r from-amber-500 to-orange-400",
        icon: <IconBarHall />,
      },
      {
        key: "gimnasio",
        label: "Gimnasio",
        amount: sum(paidGym),
        count: paidGym.length,
        color: "bg-gradient-to-r from-emerald-500 to-teal-400",
        icon: <IconBarGym />,
      },
    ];
  }, [invoices, reservations, gymSubs]);

  /** Cartera vencida/pendiente del conjunto, por concepto. */
  const adminPending: ConsumptionItem[] = useMemo(() => {
    const isPaid = (s: unknown) => String(s ?? "").toLowerCase() === "pagada";
    const pendingInvoices = invoices.filter((i) => !isPaid(i.status));
    const pendingParking = reservations.filter(
      (r) => r.amenity_type === "visitor_parking" && r.status === "Pendiente",
    );
    const pendingHall = reservations.filter(
      (r) => r.amenity_type === "social_hall" && r.status === "Pendiente",
    );
    const pendingGym = gymSubs.filter((s) => s.status === "Pendiente");
    const sum = <T extends { amount_cop: number }>(arr: T[]) =>
      arr.reduce((acc, x) => acc + (Number(x.amount_cop) || 0), 0);
    return [
      {
        key: "pending-facturas",
        label: "Administración",
        amount: sum(pendingInvoices),
        count: pendingInvoices.length,
        color: "bg-gradient-to-r from-rose-500 to-pink-500",
        icon: <IconBarInvoice />,
      },
      {
        key: "pending-parking",
        label: "Parqueadero",
        amount: sum(pendingParking),
        count: pendingParking.length,
        color: "bg-gradient-to-r from-rose-500 to-pink-500",
        icon: <IconBarCar />,
      },
      {
        key: "pending-hall",
        label: "Salón comunal",
        amount: sum(pendingHall),
        count: pendingHall.length,
        color: "bg-gradient-to-r from-rose-500 to-pink-500",
        icon: <IconBarHall />,
      },
      {
        key: "pending-gym",
        label: "Gimnasio",
        amount: sum(pendingGym),
        count: pendingGym.length,
        color: "bg-gradient-to-r from-rose-500 to-pink-500",
        icon: <IconBarGym />,
      },
    ];
  }, [invoices, reservations, gymSubs]);

  function residentLabel(userId: string): string {
    const u = residents.find((x) => x._id === userId);
    return u ? `${u.full_name} (${u.email})` : userId.slice(0, 10) + "…";
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function createUnitFromForm() {
    const code = newUnitCode.trim();
    const coefficient = Number(newUnitCoeff);
    if (!code) {
      setError("Debes ingresar el código de la unidad.");
      return;
    }
    if (!Number.isFinite(coefficient) || coefficient <= 0 || coefficient > 1) {
      setError("El coeficiente debe ser un número entre 0 y 1 (ej: 0.0123).");
      return;
    }

    setCreating(true);
    setError(null);
    setInfo(null);
    try {
      await backend.post("/units", { code, coefficient, resident_user_id: null });
      await refresh();
      setInfo(`Unidad creada: ${code.toUpperCase()} (coef ${coefficient})`);
      setNewUnitCode("");
      setNewUnitCoeff("");
      setShowNewUnit(false);
    } catch (e: any) {
      setError(e?.response?.data?.detail ?? "No se pudo crear la unidad");
    } finally {
      setCreating(false);
    }
  }

  async function generateNow() {
    setCreating(true);
    setError(null);
    setInfo(null);
    try {
      const r = await backend.post("/invoices/generate");
      await refresh();
      setInfo(`Generación completada (${r.data.created} creadas, ${r.data.skipped_existing} ya existían) para ${r.data.period}`);
    } catch (e: any) {
      setError(e?.response?.data?.detail ?? "No se pudo generar cobros");
    } finally {
      setCreating(false);
    }
  }

  async function createResidentFromForm() {
    const full_name = newResidentName.trim();
    const email = newResidentEmail.trim();
    const password = newResidentPassword;
    if (!full_name || !email || !password) {
      setError("Debes completar nombre, email y contraseña del residente.");
      return;
    }
    setCreating(true);
    setError(null);
    setInfo(null);
    try {
      const r = await backend.post("/admin/residents", { full_name, email, password });
      setInfo(`Residente creado: ${r.data.full_name} (${r.data.email})`);
      setNewResidentName("");
      setNewResidentEmail("");
      setNewResidentPassword("");
      await refresh();
    } catch (e: any) {
      setError(e?.response?.data?.detail ?? "No se pudo crear el residente");
    } finally {
      setCreating(false);
    }
  }

  async function seedDemo() {
    setCreating(true);
    setError(null);
    setInfo(null);
    try {
      const r = await backend.post("/admin/seed-demo");
      setInfo(
        `Demo listo. Admin: ${r.data.admin.email} / ${r.data.admin.password} — Residente: ${r.data.resident.email} / ${r.data.resident.password}`,
      );
      await refresh();
    } catch (e: any) {
      setError(e?.response?.data?.detail ?? "No se pudo crear demo");
    } finally {
      setCreating(false);
    }
  }

  async function assignResident(unitId: string, residentId: string | null) {
    setCreating(true);
    setError(null);
    setInfo(null);
    try {
      await backend.patch(`/units/${unitId}`, { resident_user_id: residentId });
      await refresh();
      setInfo("Asignación actualizada.");
    } catch (e: any) {
      setError(e?.response?.data?.detail ?? "No se pudo asignar residente");
    } finally {
      setCreating(false);
    }
  }

  async function startEditResident(u: User) {
    setEditingResidentId(u._id);
    setEditResidentName(u.full_name);
    setEditResidentEmail(u.email);
    setResetPwdResidentId(null);
    setResetPwdValue("");
    setEditingTaxResidentId(null);
  }

  async function saveResident() {
    if (!editingResidentId) return;
    const full_name = editResidentName.trim();
    const email = editResidentEmail.trim();
    if (!full_name || !email) {
      setError("Nombre y email son obligatorios.");
      return;
    }
    setCreating(true);
    setError(null);
    setInfo(null);
    try {
      await backend.patch(`/admin/users/${editingResidentId}`, { full_name, email });
      setInfo("Residente actualizado.");
      setEditingResidentId(null);
      await refresh();
    } catch (e: any) {
      setError(e?.response?.data?.detail ?? "No se pudo actualizar el residente");
    } finally {
      setCreating(false);
    }
  }

  function startEditTax(u: User) {
    setEditingTaxResidentId(u._id);
    const current = u.tax_profile ?? {
      identification_document_id: 3,
      identification: "",
      names: u.full_name,
      address: "",
      email: u.email,
      phone: "",
      municipality_id: 11001,
    };
    setTaxJson(JSON.stringify(current, null, 2));
    setError(null);
    setInfo(null);
  }

  async function saveTaxProfile() {
    if (!editingTaxResidentId) return;
    let parsed: any = null;
    try {
      parsed = JSON.parse(taxJson || "null");
    } catch {
      setError("JSON inválido en perfil fiscal.");
      return;
    }
    setCreating(true);
    setError(null);
    setInfo(null);
    try {
      await backend.patch(`/admin/users/${editingTaxResidentId}`, { tax_profile: parsed });
      setInfo("Perfil fiscal actualizado (Factus).");
      setEditingTaxResidentId(null);
      setTaxJson("");
      await refresh();
    } catch (e: any) {
      setError(e?.response?.data?.detail ?? "No se pudo actualizar perfil fiscal");
    } finally {
      setCreating(false);
    }
  }

  async function deleteResident(userId: string) {
    if (!confirm("¿Eliminar residente? Esto desasignará sus unidades.")) return;
    setCreating(true);
    setError(null);
    setInfo(null);
    try {
      await backend.delete(`/admin/users/${userId}`);
      setInfo("Residente eliminado.");
      await refresh();
    } catch (e: any) {
      setError(e?.response?.data?.detail ?? "No se pudo eliminar el residente");
    } finally {
      setCreating(false);
    }
  }

  async function resetResidentPassword() {
    if (!resetPwdResidentId) return;
    if (!resetPwdValue) {
      setError("Ingresa una contraseña nueva.");
      return;
    }
    setCreating(true);
    setError(null);
    setInfo(null);
    try {
      await backend.post(`/admin/users/${resetPwdResidentId}/reset-password`, { password: resetPwdValue });
      setInfo("Contraseña actualizada.");
      setResetPwdResidentId(null);
      setResetPwdValue("");
    } catch (e: any) {
      setError(e?.response?.data?.detail ?? "No se pudo cambiar contraseña");
    } finally {
      setCreating(false);
    }
  }

  function startEditUnit(u: Unit) {
    setEditingUnitId(u._id);
    setEditUnitCode(u.code);
    setEditUnitCoeff(String(u.coefficient));
  }

  async function saveUnit() {
    if (!editingUnitId) return;
    const code = editUnitCode.trim();
    const coefficient = Number(editUnitCoeff);
    if (!code) {
      setError("Código obligatorio.");
      return;
    }
    if (!Number.isFinite(coefficient) || coefficient <= 0 || coefficient > 1) {
      setError("Coeficiente debe ser 0..1");
      return;
    }
    setCreating(true);
    setError(null);
    setInfo(null);
    try {
      await backend.patch(`/units/${editingUnitId}`, { code, coefficient });
      setInfo("Unidad actualizada.");
      setEditingUnitId(null);
      await refresh();
    } catch (e: any) {
      setError(e?.response?.data?.detail ?? "No se pudo actualizar la unidad");
    } finally {
      setCreating(false);
    }
  }

  async function deleteUnit(unitId: string) {
    if (!confirm("¿Eliminar unidad? También borrará sus facturas.")) return;
    setCreating(true);
    setError(null);
    setInfo(null);
    try {
      await backend.delete(`/units/${unitId}`);
      setInfo("Unidad eliminada.");
      await refresh();
    } catch (e: any) {
      setError(e?.response?.data?.detail ?? "No se pudo eliminar la unidad");
    } finally {
      setCreating(false);
    }
  }

  async function deleteInvoice(invoiceId: string) {
    if (!confirm("¿Eliminar factura?")) return;
    setCreating(true);
    setError(null);
    setInfo(null);
    try {
      await backend.delete(`/invoices/${invoiceId}`);
      setInfo("Factura eliminada.");
      await refresh();
    } catch (e: any) {
      setError(e?.response?.data?.detail ?? "No se pudo eliminar la factura");
    } finally {
      setCreating(false);
    }
  }

  async function refreshMorosidad() {
    setCreating(true);
    setError(null);
    setInfo(null);
    try {
      const r = await backend.get("/reports/morosidad");
      setMorosidad(r.data);
      setShowMorosidad(true);
      setInfo("Reporte de morosidad actualizado.");
    } catch (e: any) {
      setError(e?.response?.data?.detail ?? "No se pudo cargar morosidad");
    } finally {
      setCreating(false);
    }
  }

  async function retryFactus(invoiceId: string) {
    setCreating(true);
    setError(null);
    setInfo(null);
    try {
      await backend.post(`/invoices/${invoiceId}/retry-factus`);
      setInfo("Reintento Factus encolado. Refresca en unos segundos.");
      await refresh();
    } catch (e: any) {
      setError(e?.response?.data?.detail ?? "No se pudo reintentar Factus");
    } finally {
      setCreating(false);
    }
  }

  async function sendFactusEmail(invoiceId: string) {
    setCreating(true);
    setError(null);
    setInfo(null);
    try {
      await backend.post(`/invoices/${invoiceId}/send-email`);
      setInfo("Correo Factus enviado (si la factura está emitida).");
    } catch (e: any) {
      setError(e?.response?.data?.detail ?? "No se pudo enviar correo Factus");
    } finally {
      setCreating(false);
    }
  }

  const SECTION_META: Record<Section, { title: string; subtitle: string }> = {
    facturas: {
      title: "Facturas",
      subtitle: "Cobros del mes, morosidad y métricas del conjunto.",
    },
    usuarios: {
      title: "Usuarios",
      subtitle: "Residentes y administradores registrados en el sistema.",
    },
    unidades: {
      title: "Unidades",
      subtitle: "Inmuebles del conjunto y coeficientes de copropiedad.",
    },
    amenidades: {
      title: "Amenidades",
      subtitle: "Parqueaderos de visitantes y salón comunal disponibles para reserva.",
    },
    reservas: {
      title: "Reservas",
      subtitle: "Historial de reservas pagadas, pendientes y canceladas.",
    },
    gimnasio: {
      title: "Gimnasio",
      subtitle: "Suscripciones mensuales activas y vencidas.",
    },
  };
  const meta = SECTION_META[section];

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
        <div className="space-y-2">
          <h2 data-testid="admin-dashboard-title" className="text-xl font-bold tracking-tight text-app-text sm:text-2xl">
            {meta.title}
          </h2>
          <p className="max-w-2xl text-sm text-app-muted">{meta.subtitle}</p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {section === "facturas" && (
            <Button onClick={generateNow} disabled={creating || units.length === 0}>
              Generar cobros (mes actual)
            </Button>
          )}
          {section === "usuarios" && (
            <Button
              onClick={() => setShowResidents(true)}
              disabled={creating}
              className="border border-app-border !bg-app-elevated text-app-text hover:!bg-app-border"
            >
              Gestionar residentes
            </Button>
          )}
          {section === "unidades" && (
            <Button
              onClick={() => setShowNewUnit(true)}
              disabled={creating}
              className="border border-app-border !bg-app-elevated text-app-text hover:!bg-app-border"
            >
              Nueva unidad
            </Button>
          )}
          <Button
            data-testid="admin-seed-demo"
            onClick={seedDemo}
            disabled={creating}
            className="!bg-emerald-600 text-white hover:!bg-emerald-500"
          >
            Crear demo
          </Button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <ConsumptionBars
          title="Recaudo del conjunto"
          subtitle="Suma de facturas, reservas y gimnasio efectivamente pagados."
          items={adminConsumption}
          totalLabel="Total recaudado"
          emptyLabel="Aún no hay pagos confirmados."
          onSelect={(key) => {
            if (key === "facturas") setSection("facturas");
            else if (key === "reservas-parking" || key === "reservas-salon") setSection("reservas");
            else if (key === "gimnasio") setSection("gimnasio");
          }}
        />
        <ConsumptionBars
          title="Cartera abierta"
          subtitle="Saldos por cobrar por concepto."
          items={adminPending}
          totalLabel="Total por cobrar"
          emptyLabel="No hay cartera abierta. ¡Vamos al día!"
          onSelect={(key) => {
            if (key === "pending-facturas") setSection("facturas");
            else if (key === "pending-parking" || key === "pending-hall") setSection("reservas");
            else if (key === "pending-gym") setSection("gimnasio");
          }}
        />
      </div>

      {showResidents && (
        <Card>
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">Residentes</h3>
            <button className="text-xs text-app-text hover:text-app-cyan" onClick={() => setShowResidents(false)}>
              Cerrar
            </button>
          </div>

          <div className="mt-5 grid gap-4 md:grid-cols-4">
            <div className="md:col-span-1">
              <label className="text-xs text-app-text">Nombre</label>
              <input
                value={newResidentName}
                onChange={(e) => setNewResidentName(e.target.value)}
                placeholder="Juan Pérez"
                className="mt-1 w-full rounded-xl border border-app-border bg-app-surface px-3 py-2.5 text-sm text-app-text outline-none placeholder:text-app-muted/60 focus-visible:ring-2 focus-visible:ring-app-cyan/35"
              />
            </div>
            <div className="md:col-span-1">
              <label className="text-xs text-app-text">Email</label>
              <input
                value={newResidentEmail}
                onChange={(e) => setNewResidentEmail(e.target.value)}
                placeholder="juan@correo.com"
                className="mt-1 w-full rounded-xl border border-app-border bg-app-surface px-3 py-2.5 text-sm text-app-text outline-none placeholder:text-app-muted/60 focus-visible:ring-2 focus-visible:ring-app-cyan/35"
              />
            </div>
            <div className="md:col-span-1">
              <label className="text-xs text-app-text">Contraseña</label>
              <input
                value={newResidentPassword}
                onChange={(e) => setNewResidentPassword(e.target.value)}
                placeholder="Residente123!"
                type="password"
                className="mt-1 w-full rounded-xl border border-app-border bg-app-surface px-3 py-2.5 text-sm text-app-text outline-none placeholder:text-app-muted/60 focus-visible:ring-2 focus-visible:ring-app-cyan/35"
              />
            </div>
            <div className="md:col-span-1 flex items-end">
              <Button onClick={createResidentFromForm} disabled={creating}>
                Crear residente
              </Button>
            </div>
          </div>

          <div className="mt-4 overflow-auto">
            <table className="w-full text-left text-xs">
              <thead className="text-app-muted">
                <tr>
                  <th className="py-3">Nombre</th>
                  <th className="py-3">Email</th>
                  <th className="py-3">Factus</th>
                  <th className="py-3">ID</th>
                  <th className="py-3 text-right">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {residents.map((u) => (
                  <tr key={u._id} className="border-t border-app-border">
                    <td className="py-3">
                      {editingResidentId === u._id ? (
                        <input
                          value={editResidentName}
                          onChange={(e) => setEditResidentName(e.target.value)}
                          className="w-full rounded-lg border border-app-border bg-app-surface px-2 py-1.5 text-xs text-app-text outline-none focus-visible:ring-2 focus-visible:ring-app-cyan/35"
                        />
                      ) : (
                        u.full_name
                      )}
                    </td>
                    <td className="py-3">
                      {editingResidentId === u._id ? (
                        <input
                          value={editResidentEmail}
                          onChange={(e) => setEditResidentEmail(e.target.value)}
                          className="w-full rounded-lg border border-app-border bg-app-surface px-2 py-1.5 text-xs text-app-text outline-none focus-visible:ring-2 focus-visible:ring-app-cyan/35"
                        />
                      ) : (
                        u.email
                      )}
                    </td>
                    <td className="py-3">
                      {u.tax_profile ? (
                        <span className="text-emerald-300">OK</span>
                      ) : (
                        <span className="text-amber-300">Falta</span>
                      )}
                    </td>
                    <td className="py-3 text-app-muted">{u._id.slice(0, 10)}…</td>
                    <td className="py-3">
                      <div className="flex justify-end gap-2">
                        {editingResidentId === u._id ? (
                          <>
                            <Button onClick={saveResident} disabled={creating} className="px-3 py-1 text-xs">
                              Guardar
                            </Button>
                            <Button
                              onClick={() => setEditingResidentId(null)}
                              disabled={creating}
                              className="border border-app-border !bg-app-elevated text-app-text hover:!bg-app-border px-3 py-1 text-xs"
                            >
                              Cancelar
                            </Button>
                          </>
                        ) : (
                          <>
                            <Button
                              onClick={() => startEditResident(u)}
                              disabled={creating}
                              className="border border-app-border !bg-app-elevated text-app-text hover:!bg-app-border px-3 py-1 text-xs"
                            >
                              Editar
                            </Button>
                            <Button
                              onClick={() => startEditTax(u)}
                              disabled={creating}
                              className="border border-app-border !bg-app-elevated text-app-text hover:!bg-app-border px-3 py-1 text-xs"
                            >
                              Fiscal
                            </Button>
                            <Button
                              onClick={() => {
                                setResetPwdResidentId(u._id);
                                setResetPwdValue("");
                              }}
                              disabled={creating}
                              className="border border-app-border !bg-app-elevated text-app-text hover:!bg-app-border px-3 py-1 text-xs"
                            >
                              Clave
                            </Button>
                            <Button
                              onClick={() => deleteResident(u._id)}
                              disabled={creating}
                              className="!bg-rose-600 px-3 py-1 text-xs font-semibold text-white hover:!bg-rose-700"
                            >
                              Eliminar
                            </Button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
                {residents.length === 0 && (
                  <tr>
                    <td colSpan={5} className="py-3 text-app-muted">
                      No hay residentes aún. Crea uno arriba o usa “Crear demo”.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {editingTaxResidentId && (
            <div className="mt-5 rounded-xl border border-app-border bg-app-surface p-4">
              <div className="flex items-center justify-between">
                <div className="text-xs text-app-text">Perfil fiscal (Factus) — JSON</div>
                <button className="text-xs text-app-text hover:text-app-cyan" onClick={() => setEditingTaxResidentId(null)}>
                  Cerrar
                </button>
              </div>
              <textarea
                value={taxJson}
                onChange={(e) => setTaxJson(e.target.value)}
                className="mt-2 h-48 w-full rounded-xl border border-app-border bg-app-elevated px-3 py-2 text-xs font-mono text-app-text outline-none focus-visible:ring-2 focus-visible:ring-app-cyan/35"
              />
              <div className="mt-2 flex gap-2">
                <Button onClick={saveTaxProfile} disabled={creating} className="px-3 py-1 text-xs">
                  Guardar
                </Button>
                <Button
                  onClick={() => {
                    setEditingTaxResidentId(null);
                    setTaxJson("");
                  }}
                  disabled={creating}
                  className="border border-app-border !bg-app-elevated text-app-text hover:!bg-app-border px-3 py-1 text-xs"
                >
                  Cancelar
                </Button>
              </div>
              <div className="mt-2 text-[11px] text-app-muted">
                Campos mínimos: identification_document_id, identification, names, address, email, phone, municipality_id.
              </div>
            </div>
          )}

          {resetPwdResidentId && (
            <div className="mt-5 rounded-xl border border-app-border bg-app-surface p-4">
              <div className="text-xs text-app-text">Cambiar contraseña (residente)</div>
              <div className="mt-2 flex flex-wrap gap-2">
                <input
                  value={resetPwdValue}
                  onChange={(e) => setResetPwdValue(e.target.value)}
                  placeholder="Nueva contraseña"
                  type="password"
                  className="w-64 rounded-xl border border-app-border bg-app-elevated px-3 py-2 text-xs text-app-text outline-none focus-visible:ring-2 focus-visible:ring-app-cyan/35"
                />
                <Button onClick={resetResidentPassword} disabled={creating} className="px-3 py-1 text-xs">
                  Guardar
                </Button>
                <Button
                  onClick={() => setResetPwdResidentId(null)}
                  disabled={creating}
                  className="border border-app-border !bg-app-elevated text-app-text hover:!bg-app-border px-3 py-1 text-xs"
                >
                  Cancelar
                </Button>
              </div>
            </div>
          )}
        </Card>
      )}

      {showNewUnit && (
        <Card>
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">Crear unidad</h3>
            <button className="text-xs text-app-text hover:text-app-cyan" onClick={() => setShowNewUnit(false)}>
              Cerrar
            </button>
          </div>
          <div className="mt-5 grid gap-4 md:grid-cols-3">
            <div className="md:col-span-1">
              <label className="text-xs text-app-text">Código</label>
              <input
                value={newUnitCode}
                onChange={(e) => setNewUnitCode(e.target.value)}
                placeholder="APT-101"
                className="mt-1 w-full rounded-xl border border-app-border bg-app-surface px-3 py-2.5 text-sm text-app-text outline-none placeholder:text-app-muted/60 focus-visible:ring-2 focus-visible:ring-app-cyan/35"
              />
            </div>
            <div className="md:col-span-1">
              <label className="text-xs text-app-text">Coeficiente</label>
              <input
                value={newUnitCoeff}
                onChange={(e) => setNewUnitCoeff(e.target.value)}
                placeholder="0.0123"
                className="mt-1 w-full rounded-xl border border-app-border bg-app-surface px-3 py-2.5 text-sm text-app-text outline-none placeholder:text-app-muted/60 focus-visible:ring-2 focus-visible:ring-app-cyan/35"
              />
            </div>
            <div className="md:col-span-1 flex items-end gap-2">
              <Button onClick={createUnitFromForm} disabled={creating}>
                Guardar unidad
              </Button>
              <Button
                onClick={() => {
                  setNewUnitCode("");
                  setNewUnitCoeff("");
                }}
                disabled={creating}
                className="border border-app-border !bg-app-elevated text-app-text hover:!bg-app-border"
              >
                Limpiar
              </Button>
            </div>
          </div>
          <p className="mt-2 text-xs text-app-muted">
            Tip: El coeficiente debe estar entre 0 y 1. Ejemplo: 1.23% = 0.0123
          </p>
        </Card>
      )}

      {showMorosidad && (
        <Card>
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">Reporte de morosidad</h3>
            <button className="text-xs text-app-text hover:text-app-cyan" onClick={() => setShowMorosidad(false)}>
              Cerrar
            </button>
          </div>
          <div className="mt-3 overflow-auto">
            <table className="w-full text-left text-xs">
              <thead className="text-app-muted">
                <tr>
                  <th className="py-3">Unidad</th>
                  <th className="py-3">Residente</th>
                  <th className="py-3">Vencidas</th>
                  <th className="py-3">Adeudado</th>
                  <th className="py-3">Último venc.</th>
                </tr>
              </thead>
              <tbody>
                {morosidad.map((m) => (
                  <tr key={m.unit_id} className="border-t border-app-border">
                    <td className="py-3">{m.unit_code ?? m.unit_id.slice(0, 8) + "…"}</td>
                    <td className="py-3 text-app-text">{m.resident_email ?? "—"}</td>
                    <td className="py-3">{m.overdue_count}</td>
                    <td className="py-3">${m.overdue_amount_cop.toLocaleString("es-CO")}</td>
                    <td className="py-3">{m.last_due_date ? new Date(m.last_due_date).toLocaleDateString("es-CO") : "—"}</td>
                  </tr>
                ))}
                {morosidad.length === 0 && (
                  <tr>
                    <td colSpan={5} className="py-3 text-app-muted">
                      No hay morosidad (o aún no se ha calculado).
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {units.length === 0 && (section === "unidades" || section === "facturas") && (
        <div className="rounded-2xl border border-app-warning-border bg-app-warning-bg p-4 text-sm leading-relaxed text-app-warning-text">
          Primero crea al menos 1 unidad con su coeficiente. Si no hay unidades, “Generar cobros” no crea facturas.
        </div>
      )}

      {error && (
        <div className="rounded-2xl border border-app-danger-border bg-app-danger-bg p-4 text-sm text-app-danger-text">{error}</div>
      )}
      {info && (
        <div className="rounded-2xl border border-app-success-border bg-app-success-bg p-4 text-sm text-app-success-text">{info}</div>
      )}

      {section === "facturas" && (
        <Card>
          <MiniChart
            title="Resumen de facturas (métricas del conjunto)"
            subtitle="Barras proporcionales al conteo mayor (si todo es 0, se muestra un ejemplo tenue)."
            items={[
              { label: "Pendientes", value: dash?.facturas.pendientes ?? 0, fill: CHART_CYAN },
              { label: "Vencidas", value: dash?.facturas.vencidas ?? 0, fill: CHART_AMBER },
              { label: "Pagadas", value: dash?.facturas.pagadas ?? 0, fill: CHART_EMERALD },
            ]}
          />
          <div className="mt-5 grid gap-4 sm:grid-cols-4">
            <div className="rounded-xl border border-app-border bg-app-elevated p-4">
              <div className="text-xs text-app-muted">Total recaudado</div>
              <div className="mt-1 text-xl font-semibold text-app-text">
                ${dash?.total_recaudado_cop?.toLocaleString("es-CO") ?? "—"}
              </div>
            </div>
            <div className="rounded-xl border border-app-border bg-app-elevated p-4">
              <div className="text-xs text-app-muted">Pendientes</div>
              <div className="mt-1 text-xl font-semibold text-app-text">{dash?.facturas.pendientes ?? "—"}</div>
            </div>
            <div className="rounded-xl border border-app-border bg-app-elevated p-4">
              <div className="text-xs text-app-muted">Vencidas</div>
              <div className="mt-1 text-xl font-semibold text-app-text">{dash?.facturas.vencidas ?? "—"}</div>
            </div>
            <div className="rounded-xl border border-app-border bg-app-elevated p-4">
              <div className="text-xs text-app-muted">Pagadas</div>
              <div className="mt-1 text-xl font-semibold text-app-text">{dash?.facturas.pagadas ?? "—"}</div>
            </div>
          </div>
        </Card>
      )}

      {section === "usuarios" && (
        <Card>
          <MiniChart
            title="Usuarios (residentes)"
            subtitle="Comparación rápida entre total y estado del perfil fiscal (Factus)."
            items={[
              { label: "Total", value: residents.length, fill: CHART_CYAN },
              {
                label: "Con perfil fiscal",
                value: residents.filter((r) => Boolean(r.tax_profile)).length,
                fill: CHART_EMERALD,
              },
              {
                label: "Falta perfil fiscal",
                value: residents.filter((r) => !r.tax_profile).length,
                fill: CHART_AMBER,
              },
            ]}
          />
          <div className="mt-5 flex flex-wrap gap-3">
            <Button
              onClick={() => {
                setShowResidents(true);
              }}
              disabled={creating}
              className="border border-app-border !bg-app-elevated text-app-text hover:!bg-app-border"
            >
              Crear / editar residentes
            </Button>
          </div>
        </Card>
      )}

      {section === "unidades" && (
        <Card>
          <MiniChart
            title="Unidades"
            subtitle="Asignación de residentes por unidad habitacional."
            items={[
              { label: "Total", value: units.length, fill: CHART_CYAN },
              {
                label: "Asignadas",
                value: units.filter((u) => Boolean(u.resident_user_id)).length,
                fill: CHART_EMERALD,
              },
              {
                label: "Sin asignar",
                value: units.filter((u) => !u.resident_user_id).length,
                fill: CHART_AMBER,
              },
            ]}
          />
          <div className="mt-5 flex flex-wrap gap-3">
            <Button
              onClick={() => setShowNewUnit((v) => !v)}
              disabled={creating}
              className="border border-app-border !bg-app-elevated text-app-text hover:!bg-app-border"
            >
              Crear unidad
            </Button>
          </div>
        </Card>
      )}

      <div className="flex flex-col gap-8">
        {section === "unidades" && (
        <Card className="min-w-0">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">Unidades</h3>
            <span className="text-xs text-app-muted">{units.length}</span>
          </div>
          <div className="mt-3 max-h-[min(60vh,28rem)] overflow-auto">
            <table className="w-full text-left text-xs">
              <thead className="text-app-muted">
                <tr>
                  <th className="py-3">Código</th>
                  <th className="py-3">Coeficiente</th>
                  <th className="py-3">Residente</th>
                  <th className="py-3 text-right">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {units.map((u) => (
                  <tr key={u._id} className="border-t border-app-border">
                    <td className="py-3">
                      {editingUnitId === u._id ? (
                        <input
                          value={editUnitCode}
                          onChange={(e) => setEditUnitCode(e.target.value)}
                          className="w-full rounded-lg border border-app-border bg-app-surface px-2 py-1.5 text-xs text-app-text outline-none focus-visible:ring-2 focus-visible:ring-app-cyan/35"
                        />
                      ) : (
                        u.code
                      )}
                    </td>
                    <td className="py-3">
                      {editingUnitId === u._id ? (
                        <input
                          value={editUnitCoeff}
                          onChange={(e) => setEditUnitCoeff(e.target.value)}
                          className="w-full rounded-lg border border-app-border bg-app-surface px-2 py-1.5 text-xs text-app-text outline-none focus-visible:ring-2 focus-visible:ring-app-cyan/35"
                        />
                      ) : (
                        u.coefficient
                      )}
                    </td>
                    <td className="py-3">
                      <select
                        value={u.resident_user_id ?? ""}
                        onChange={(e) => assignResident(u._id, e.target.value ? e.target.value : null)}
                        className="w-full rounded-lg border border-app-border bg-app-surface px-2 py-1.5 text-xs text-app-text outline-none focus-visible:ring-2 focus-visible:ring-app-cyan/35"
                        disabled={creating}
                      >
                        <option value="">— Sin asignar —</option>
                        {residents.map((r) => (
                          <option key={r._id} value={r._id}>
                            {r.full_name} ({r.email})
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="py-3">
                      <div className="flex justify-end gap-2">
                        {editingUnitId === u._id ? (
                          <>
                            <Button onClick={saveUnit} disabled={creating} className="px-3 py-1 text-xs">
                              Guardar
                            </Button>
                            <Button
                              onClick={() => setEditingUnitId(null)}
                              disabled={creating}
                              className="border border-app-border !bg-app-elevated text-app-text hover:!bg-app-border px-3 py-1 text-xs"
                            >
                              Cancelar
                            </Button>
                          </>
                        ) : (
                          <>
                            <Button
                              onClick={() => startEditUnit(u)}
                              disabled={creating}
                              className="border border-app-border !bg-app-elevated text-app-text hover:!bg-app-border px-3 py-1 text-xs"
                            >
                              Editar
                            </Button>
                            <Button
                              onClick={() => deleteUnit(u._id)}
                              disabled={creating}
                              className="!bg-rose-600 px-3 py-1 text-xs font-semibold text-white hover:!bg-rose-700"
                            >
                              Eliminar
                            </Button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
        )}

        {section === "facturas" && (
        <Card className="min-w-0">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">Facturas recientes</h3>
            <span className="text-xs text-app-muted" title="Filtradas / total en catálogo">
              {appliedInvoiceStatus || appliedInvoicePeriod
                ? `${visibleInvoices.length} / ${invoices.length}`
                : invoices.length}
            </span>
          </div>
          <div className="mt-4">
            <MiniChart
              title="Distribución (catálogo actual)"
              subtitle="Conteos por estado en las facturas cargadas desde el servidor."
              items={[
                {
                  label: "Pendiente",
                  value: invoices.filter((i) => rowStatusNorm(i) === "pendiente").length,
                  fill: CHART_CYAN,
                },
                {
                  label: "Vencida",
                  value: invoices.filter((i) => rowStatusNorm(i) === "vencida").length,
                  fill: CHART_AMBER,
                },
                {
                  label: "Pagada",
                  value: invoices.filter((i) => rowStatusNorm(i) === "pagada").length,
                  fill: CHART_EMERALD,
                },
              ]}
            />
          </div>
          <form
            className="mt-3 flex flex-wrap items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              commitInvoiceFilters();
            }}
          >
            <div>
              <label className="block text-xs text-app-text" htmlFor="invoice-filter-status">
                Estado
              </label>
              <select
                id="invoice-filter-status"
                value={invoiceStatus}
                onChange={(e) => {
                  const v = e.target.value;
                  setInvoiceStatus(v);
                  commitInvoiceFilters({ status: v, period: invoicePeriod });
                }}
                className="mt-1 rounded-xl border border-app-border bg-app-surface px-2 py-2 text-xs text-app-text outline-none focus-visible:ring-2 focus-visible:ring-app-cyan/35"
              >
                <option value="">(Todos)</option>
                <option value="Pendiente">Pendiente</option>
                <option value="Vencida">Vencida</option>
                <option value="Pagada">Pagada</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-app-text" htmlFor="invoice-filter-period">
                Periodo (YYYY-MM)
              </label>
              <input
                id="invoice-filter-period"
                value={invoicePeriod}
                onChange={(e) => setInvoicePeriod(e.target.value)}
                placeholder="2026-04"
                className="mt-1 w-28 rounded-xl border border-app-border bg-app-surface px-2 py-2 text-xs text-app-text outline-none focus-visible:ring-2 focus-visible:ring-app-cyan/35"
              />
            </div>
            <Button type="submit" className="px-3 py-1 text-xs">
              Aplicar filtros
            </Button>
            {(invoiceStatus || invoicePeriod || appliedInvoiceStatus || appliedInvoicePeriod) && (
              <Button
                type="button"
                onClick={() => {
                  setInvoiceStatus("");
                  setInvoicePeriod("");
                  setAppliedInvoiceStatus("");
                  setAppliedInvoicePeriod("");
                  setInvoiceFilterError(null);
                }}
                className="border border-app-border !bg-app-elevated text-app-text hover:!bg-app-border px-3 py-1 text-xs"
              >
                Limpiar
              </Button>
            )}
          </form>
          {invoiceFilterError && (
            <div className="mt-3 rounded-2xl border border-app-danger-border bg-app-danger-bg p-3 text-sm text-app-danger-text">
              {invoiceFilterError}
            </div>
          )}
          <div className="mt-3 max-h-[min(50vh,24rem)] overflow-auto">
            <table className="w-full text-left text-xs">
              <thead className="sticky top-0 z-[1] bg-app-elevated/95 text-app-muted backdrop-blur-sm">
                <tr>
                  <th className="py-3">Periodo</th>
                  <th className="py-3">Unidad</th>
                  <th className="py-3">Valor</th>
                  <th className="py-3">Estado</th>
                  <th className="py-3">Factus</th>
                  <th className="py-3 text-right">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {visibleInvoices.slice(0, 20).map((i) => (
                  <tr key={i._id} className="border-t border-app-border">
                    <td className="py-3">{i.period}</td>
                    <td className="py-3">{i.unit_id.slice(0, 8)}…</td>
                    <td className="py-3">${i.amount_cop.toLocaleString("es-CO")}</td>
                    <td className="py-3">{i.status}</td>
                    <td className="py-3">
                      {i.factus_invoice_id ? (
                        <span className="text-emerald-300">Emitida</span>
                      ) : i.factus_error ? (
                        <span className="text-amber-300">Error</span>
                      ) : (
                        <span className="text-app-muted">—</span>
                      )}
                    </td>
                    <td className="py-3 text-right">
                      <div className="flex justify-end gap-2">
                        <Button
                          onClick={() => setSelectedInvoice(i)}
                          disabled={creating}
                          className="border border-app-border !bg-app-elevated text-app-text hover:!bg-app-border px-3 py-1 text-xs"
                        >
                          Ver
                        </Button>
                        {!i.factus_invoice_id && (
                          <Button onClick={() => retryFactus(i._id)} disabled={creating} className="px-3 py-1 text-xs">
                            Reintentar Factus
                          </Button>
                        )}
                        <Button
                          onClick={() => deleteInvoice(i._id)}
                          disabled={creating}
                          className="!bg-rose-600 px-3 py-1 text-xs font-semibold text-white hover:!bg-rose-700"
                        >
                          Eliminar
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
                {visibleInvoices.length === 0 && (
                  <tr>
                    <td colSpan={6} className="py-3 text-app-muted">
                      {invoices.length === 0
                        ? "No hay facturas aún."
                        : "Ninguna factura coincide con los filtros aplicados."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
        )}
      </div>

      {section === "amenidades" && (
        <Card>
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">Amenidades</h3>
            <span className="text-xs text-app-muted">{amenities.length}</span>
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-4">
            <div className="md:col-span-1">
              <label className="text-xs text-app-text">Tipo</label>
              <select
                value={newAmenityType}
                onChange={(e) => setNewAmenityType(e.target.value as any)}
                className="mt-1 w-full rounded-xl border border-app-border bg-app-surface px-3 py-2.5 text-sm text-app-text outline-none focus-visible:ring-2 focus-visible:ring-app-cyan/35"
              >
                <option value="visitor_parking">Parqueadero visitantes</option>
                <option value="social_hall">Salón comunal</option>
              </select>
            </div>
            <div className="md:col-span-2">
              <label className="text-xs text-app-text">Código</label>
              <input
                value={newAmenityCode}
                onChange={(e) => setNewAmenityCode(e.target.value)}
                placeholder={newAmenityType === "visitor_parking" ? "VIS-01" : "SALON-A"}
                className="mt-1 w-full rounded-xl border border-app-border bg-app-surface px-3 py-2.5 text-sm text-app-text outline-none placeholder:text-app-muted/60 focus-visible:ring-2 focus-visible:ring-app-cyan/35"
              />
            </div>
            <div className="md:col-span-1 flex items-end">
              <Button data-testid="admin-amenity-create" onClick={createAmenity} disabled={creating}>
                Crear amenidad
              </Button>
            </div>
          </div>

          <div className="mt-5 max-h-[min(60vh,28rem)] overflow-auto">
            <table className="w-full text-left text-xs">
              <thead className="text-app-muted">
                <tr>
                  <th className="py-3">Tipo</th>
                  <th className="py-3">Código</th>
                  <th className="py-3">Activa</th>
                  <th className="py-3 text-right">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {amenities.map((a) => (
                  <tr key={a._id} className="border-t border-app-border">
                    <td className="py-3">
                      {a.type === "visitor_parking" ? "Parqueadero" : "Salón"}
                    </td>
                    <td className="py-3">{a.code}</td>
                    <td className="py-3">
                      {a.active ? (
                        <span className="text-emerald-300">Sí</span>
                      ) : (
                        <span className="text-amber-300">No</span>
                      )}
                    </td>
                    <td className="py-3 text-right">
                      <div className="flex justify-end gap-2">
                        <Button
                          onClick={() => toggleAmenity(a)}
                          disabled={busyId === a._id}
                          className="border border-app-border !bg-app-elevated text-app-text hover:!bg-app-border px-3 py-1 text-xs"
                        >
                          {busyId === a._id ? "…" : a.active ? "Desactivar" : "Activar"}
                        </Button>
                        <Button
                          onClick={() => deleteAmenity(a._id)}
                          disabled={busyId === a._id}
                          className="!bg-rose-600 px-3 py-1 text-xs font-semibold text-white hover:!bg-rose-700"
                        >
                          Eliminar
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
                {amenities.length === 0 && (
                  <tr>
                    <td colSpan={4} className="py-3 text-app-muted">
                      Sin amenidades. Crea una arriba o usa “Crear demo”.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {section === "reservas" && (
        <Card>
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">Reservas</h3>
            <span className="text-xs text-app-muted">
              {resStatusFilter || resTypeFilter
                ? `${visibleReservations.length} / ${reservations.length}`
                : reservations.length}
            </span>
          </div>
          <div className="mt-3 flex flex-wrap items-end gap-2">
            <div>
              <label className="block text-xs text-app-text">Tipo</label>
              <select
                value={resTypeFilter}
                onChange={(e) => setResTypeFilter(e.target.value)}
                className="mt-1 rounded-xl border border-app-border bg-app-surface px-2 py-2 text-xs text-app-text outline-none focus-visible:ring-2 focus-visible:ring-app-cyan/35"
              >
                <option value="">(Todos)</option>
                <option value="visitor_parking">Parqueadero</option>
                <option value="social_hall">Salón</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-app-text">Estado</label>
              <select
                value={resStatusFilter}
                onChange={(e) => setResStatusFilter(e.target.value)}
                className="mt-1 rounded-xl border border-app-border bg-app-surface px-2 py-2 text-xs text-app-text outline-none focus-visible:ring-2 focus-visible:ring-app-cyan/35"
              >
                <option value="">(Todos)</option>
                <option value="Pendiente">Pendiente</option>
                <option value="Pagada">Pagada</option>
                <option value="Cancelada">Cancelada</option>
              </select>
            </div>
            {(resStatusFilter || resTypeFilter) && (
              <Button
                type="button"
                onClick={() => {
                  setResStatusFilter("");
                  setResTypeFilter("");
                }}
                className="border border-app-border !bg-app-elevated text-app-text hover:!bg-app-border px-3 py-1 text-xs"
              >
                Limpiar
              </Button>
            )}
          </div>
          <div className="mt-3 max-h-[min(60vh,28rem)] overflow-auto">
            <table className="w-full text-left text-xs">
              <thead className="sticky top-0 z-[1] bg-app-elevated/95 text-app-muted backdrop-blur-sm">
                <tr>
                  <th className="py-3">Recurso</th>
                  <th className="py-3">Residente</th>
                  <th className="py-3">Inicio</th>
                  <th className="py-3">Fin</th>
                  <th className="py-3">Valor</th>
                  <th className="py-3">PIN</th>
                  <th className="py-3">Estado</th>
                  <th className="py-3 text-right">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {visibleReservations.map((r) => (
                  <tr key={r._id} className="border-t border-app-border">
                    <td className="py-3">
                      {r.amenity_code}
                      <div className="text-[10px] text-app-muted">
                        {r.amenity_type === "visitor_parking" ? "Parqueadero" : "Salón"}
                      </div>
                    </td>
                    <td className="py-3 text-app-text">{residentLabel(r.user_id)}</td>
                    <td className="py-3">{new Date(r.start_at).toLocaleString("es-CO")}</td>
                    <td className="py-3">{new Date(r.end_at).toLocaleString("es-CO")}</td>
                    <td className="py-3">${r.amount_cop.toLocaleString("es-CO")}</td>
                    <td className="py-3">
                      {r.amenity_type === "visitor_parking" && r.access_pin ? (
                        <span className="font-mono text-xs text-app-text">{r.access_pin}</span>
                      ) : (
                        <span className="text-xs text-app-muted">—</span>
                      )}
                    </td>
                    <td className="py-3">{r.status}</td>
                    <td className="py-3 text-right">
                      <div className="flex justify-end gap-2">
                        {r.status !== "Cancelada" && (
                          <Button
                            onClick={() => cancelReservation(r._id)}
                            disabled={busyId === r._id}
                            className="border border-app-border !bg-app-elevated text-app-text hover:!bg-app-border px-3 py-1 text-xs"
                          >
                            {busyId === r._id ? "…" : "Cancelar"}
                          </Button>
                        )}
                        <Button
                          onClick={() => deleteReservation(r._id)}
                          disabled={busyId === r._id}
                          className="!bg-rose-600 px-3 py-1 text-xs font-semibold text-white hover:!bg-rose-700"
                        >
                          Eliminar
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
                {visibleReservations.length === 0 && (
                  <tr>
                    <td colSpan={8} className="py-3 text-app-muted">
                      {reservations.length === 0 ? "No hay reservas aún." : "Ninguna coincide con los filtros."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {section === "gimnasio" && (
        <Card>
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">Suscripciones gimnasio</h3>
            <span className="text-xs text-app-muted">
              {gymPeriodFilter ? `${visibleGymSubs.length} / ${gymSubs.length}` : gymSubs.length}
            </span>
          </div>
          <div className="mt-3 flex flex-wrap items-end gap-2">
            <div>
              <label className="block text-xs text-app-text">Periodo (YYYY-MM)</label>
              <input
                value={gymPeriodFilter}
                onChange={(e) => setGymPeriodFilter(e.target.value)}
                placeholder="2026-04"
                className="mt-1 w-28 rounded-xl border border-app-border bg-app-surface px-2 py-2 text-xs text-app-text outline-none focus-visible:ring-2 focus-visible:ring-app-cyan/35"
              />
            </div>
            {gymPeriodFilter && (
              <Button
                type="button"
                onClick={() => setGymPeriodFilter("")}
                className="border border-app-border !bg-app-elevated text-app-text hover:!bg-app-border px-3 py-1 text-xs"
              >
                Limpiar
              </Button>
            )}
          </div>
          <div className="mt-3 max-h-[min(60vh,28rem)] overflow-auto">
            <table className="w-full text-left text-xs">
              <thead className="sticky top-0 z-[1] bg-app-elevated/95 text-app-muted backdrop-blur-sm">
                <tr>
                  <th className="py-3">Periodo</th>
                  <th className="py-3">Residente</th>
                  <th className="py-3">Valor</th>
                  <th className="py-3">Estado</th>
                  <th className="py-3 text-right">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {visibleGymSubs.map((s) => (
                  <tr key={s._id} className="border-t border-app-border">
                    <td className="py-3">{s.period}</td>
                    <td className="py-3 text-app-text">{residentLabel(s.user_id)}</td>
                    <td className="py-3">${s.amount_cop.toLocaleString("es-CO")}</td>
                    <td className="py-3">{s.status}</td>
                    <td className="py-3 text-right">
                      <Button
                        onClick={() => deleteGymSub(s._id)}
                        disabled={busyId === s._id}
                        className="!bg-rose-600 px-3 py-1 text-xs font-semibold text-white hover:!bg-rose-700"
                      >
                        {busyId === s._id ? "…" : "Eliminar"}
                      </Button>
                    </td>
                  </tr>
                ))}
                {visibleGymSubs.length === 0 && (
                  <tr>
                    <td colSpan={5} className="py-3 text-app-muted">
                      {gymSubs.length === 0 ? "Sin suscripciones aún." : "Ninguna coincide con el filtro."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {selectedInvoice && (
        <Card>
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">Detalle de factura</h3>
            <button className="text-xs text-app-text hover:text-app-cyan" onClick={() => setSelectedInvoice(null)}>
              Cerrar
            </button>
          </div>
          <div className="mt-2 text-xs text-app-muted">ID: {selectedInvoice._id}</div>
          <div className="mt-3 flex flex-wrap gap-2">
            {selectedInvoice.factus_invoice_id && (
              <Button onClick={() => sendFactusEmail(selectedInvoice._id)} disabled={creating} className="px-3 py-1 text-xs">
                Reenviar correo (Factus)
              </Button>
            )}
            <Button
              onClick={() => retryFactus(selectedInvoice._id)}
              disabled={creating}
              className="border border-app-border !bg-app-elevated text-app-text hover:!bg-app-border px-3 py-1 text-xs"
            >
              Reintentar Factus
            </Button>
          </div>
          {selectedInvoice.factus_error && (
            <div className="mt-3 rounded-2xl border border-app-warning-border bg-app-warning-bg p-3 text-sm text-app-warning-text">
              Factus error: {selectedInvoice.factus_error}
            </div>
          )}
          <pre className="mt-4 max-h-80 overflow-auto rounded-xl border border-app-border bg-app-elevated p-4 text-xs leading-relaxed text-app-text">
            {JSON.stringify(selectedInvoice, null, 2)}
          </pre>
        </Card>
      )}
    </div>
  );
}

