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
import { backend, payments } from "../../lib/api";
import { useSection, type ResidentSection } from "../../lib/section";

type Invoice = {
  _id: string;
  period: string;
  amount_cop: number;
  status: string;
  due_date: string;
  pdf_url?: string | null;
  xml_url?: string | null;
  factus_public_url?: string | null;
};

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

type Tab = ResidentSection;
type TargetKind = "invoice" | "reservation" | "gym_subscription";

function currentPeriod(): string {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

function formatLocalDateTime(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatLocalDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Hora actual redondeada hacia arriba al próximo cuarto de hora. */
function nextQuarter(): Date {
  const d = new Date();
  d.setSeconds(0, 0);
  const mins = d.getMinutes();
  const add = mins === 0 ? 0 : 15 - (mins % 15);
  d.setMinutes(mins + add);
  return d;
}

function addHours(d: Date, hours: number): Date {
  const copy = new Date(d);
  copy.setHours(copy.getHours() + hours);
  return copy;
}

function addDays(d: Date, days: number): Date {
  const copy = new Date(d);
  copy.setDate(copy.getDate() + days);
  return copy;
}

export default function ResidentDashboard() {
  /** Pestaña activa controlada desde el sidebar (vía SectionContext). */
  const { section: sectionRaw, setSection: setSectionRaw } = useSection();
  const tab = sectionRaw as Tab;
  const setTab = (t: Tab) => setSectionRaw(t);

  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [amenities, setAmenities] = useState<Amenity[]>([]);
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [gymSubs, setGymSubs] = useState<GymSubscription[]>([]);

  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [showProcess, setShowProcess] = useState(false);
  const [steps, setSteps] = useState<Array<{ at: string; title: string; detail?: string }>>([]);
  const [gateway, setGateway] = useState<"auto" | "mock" | "wompi" | "epayco">("auto");
  const [pendingPayment, setPendingPayment] = useState<{ paymentId: string; targetKind: TargetKind; targetId: string } | null>(null);

  // Form: parqueadero visitantes
  const [parkingAmenityId, setParkingAmenityId] = useState("");
  const [parkingStart, setParkingStart] = useState("");
  const [parkingEnd, setParkingEnd] = useState("");

  // Form: salón comunal
  const [hallAmenityId, setHallAmenityId] = useState("");
  const [hallDate, setHallDate] = useState("");

  function logStep(title: string, detail?: string) {
    setShowProcess(true);
    setSteps((s) => [{ at: new Date().toLocaleTimeString("es-CO"), title, detail }, ...s].slice(0, 40));
  }

  async function refreshAll() {
    setError(null);
    try {
      const [inv, am, res, gym] = await Promise.all([
        backend.get("/invoices/my"),
        backend.get("/amenities", { params: { active: true } }),
        backend.get("/reservations/my"),
        backend.get("/gym/subscriptions/my"),
      ]);
      setInvoices(inv.data);
      setAmenities(am.data);
      setReservations(res.data);
      setGymSubs(gym.data);
    } catch (e: any) {
      setError(e?.response?.data?.detail ?? "No se pudieron cargar tus datos");
    }
  }

  useEffect(() => {
    void refreshAll();
  }, []);

  const parkings = useMemo(() => amenities.filter((a) => a.type === "visitor_parking" && a.active), [amenities]);
  const halls = useMemo(() => amenities.filter((a) => a.type === "social_hall" && a.active), [amenities]);

  const period = currentPeriod();
  const gymCurrent = useMemo(() => gymSubs.find((s) => s.period === period) ?? null, [gymSubs, period]);

  // Tarifas (deben coincidir con backend/app/core/config.py)
  const PARKING_HOURLY_COP = 2000;
  const HALL_DAILY_COP = 80000;

  /** Estimación local del costo de parqueadero (horas redondeadas hacia arriba). */
  const parkingEstimate = useMemo(() => {
    if (!parkingStart || !parkingEnd) return null;
    const s = new Date(parkingStart).getTime();
    const e = new Date(parkingEnd).getTime();
    if (!Number.isFinite(s) || !Number.isFinite(e) || e <= s) return null;
    const hours = Math.max(1, Math.ceil((e - s) / 3_600_000));
    return { hours, amount: hours * PARKING_HOURLY_COP };
  }, [parkingStart, parkingEnd]);

  /** Estimación local del costo del salón comunal (1 día). */
  const hallEstimate = useMemo(() => {
    if (!hallDate) return null;
    return { days: 1, amount: HALL_DAILY_COP };
  }, [hallDate]);

  /**
   * Consumo agregado del residente (lo que YA pagó), separado por categoría.
   * Sirve para alimentar las barras interactivas del header.
   */
  const consumption: ConsumptionItem[] = useMemo(() => {
    const paidInvoices = invoices.filter((i) => i.status === "Pagada");
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
        key: "parqueadero",
        label: "Parqueadero",
        amount: sum(paidParking),
        count: paidParking.length,
        color: "bg-gradient-to-r from-sky-500 to-cyan-400",
        icon: <IconBarCar />,
      },
      {
        key: "salon",
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

  /**
   * Pendientes por pagar del residente: sirve como segunda visualización
   * para que la persona vea cuánto le falta y por qué concepto.
   */
  const pending: ConsumptionItem[] = useMemo(() => {
    const pendingInvoices = invoices.filter((i) => i.status !== "Pagada");
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
        key: "facturas",
        label: "Administración",
        amount: sum(pendingInvoices),
        count: pendingInvoices.length,
        color: "bg-gradient-to-r from-rose-500 to-pink-500",
        icon: <IconBarInvoice />,
      },
      {
        key: "parqueadero",
        label: "Parqueadero",
        amount: sum(pendingParking),
        count: pendingParking.length,
        color: "bg-gradient-to-r from-rose-500 to-pink-500",
        icon: <IconBarCar />,
      },
      {
        key: "salon",
        label: "Salón comunal",
        amount: sum(pendingHall),
        count: pendingHall.length,
        color: "bg-gradient-to-r from-rose-500 to-pink-500",
        icon: <IconBarHall />,
      },
      {
        key: "gimnasio",
        label: "Gimnasio",
        amount: sum(pendingGym),
        count: pendingGym.length,
        color: "bg-gradient-to-r from-rose-500 to-pink-500",
        icon: <IconBarGym />,
      },
    ];
  }, [invoices, reservations, gymSubs]);

  // Pre-llenar (una sola vez) los formularios al entrar a su tab,
  // para evitar que parezcan "rotos" por estar vacíos.
  const [parkingPrefilled, setParkingPrefilled] = useState(false);
  const [hallPrefilled, setHallPrefilled] = useState(false);

  useEffect(() => {
    if (tab !== "parqueadero" || parkingPrefilled) return;
    if (parkings.length === 0) return;
    setParkingAmenityId((cur) => cur || parkings[0]._id);
    const start = nextQuarter();
    setParkingStart((cur) => cur || formatLocalDateTime(start));
    setParkingEnd((cur) => cur || formatLocalDateTime(addHours(start, 2)));
    setParkingPrefilled(true);
  }, [tab, parkings, parkingPrefilled]);

  useEffect(() => {
    if (tab !== "salon" || hallPrefilled) return;
    if (halls.length === 0) return;
    setHallAmenityId((cur) => cur || halls[0]._id);
    setHallDate((cur) => cur || formatLocalDate(addDays(new Date(), 1)));
    setHallPrefilled(true);
  }, [tab, halls, hallPrefilled]);

  async function pay(targetKind: TargetKind, targetId: string) {
    setLoading(true);
    setError(null);
    try {
      const payload: any = { target_kind: targetKind, target_id: targetId };
      if (import.meta.env.DEV && gateway !== "auto") payload.provider = gateway;
      logStep("POST payments: crear pago", JSON.stringify(payload));
      const r = await payments.post("/payments", payload);
      const paymentId = r.data.payment_id as string;
      const provider = r.data.provider as string;
      const link = r.data.payment_link as string;
      logStep("Respuesta create_payment", JSON.stringify({ payment_id: paymentId, provider, payment_link: link }));

      try {
        const p = await payments.get(`/payments/${paymentId}`);
        logStep("GET payments/{id}: estado inicial", JSON.stringify({ status: p.data.status, provider_ref: p.data.provider_ref }));
      } catch {
        // ignore
      }

      if (import.meta.env.DEV && provider !== "mock") {
        logStep("POST demo/confirm: simular confirmación", paymentId);
        await payments.post(`/demo/confirm/${paymentId}`);
        logStep("Confirmación demo aplicada", "Marcado como Pagado (demo)");
        await refreshAll();
        return;
      }

      if (provider === "mock") {
        logStep("POST mock/confirm: simular confirmación", paymentId);
        await payments.post(`/mock/confirm/${paymentId}`);
        logStep("Confirmación mock aplicada", "Marcado como Pagado (mock)");
        await refreshAll();
      } else if (provider === "epayco" && link.startsWith("epayco_session:")) {
        const sessionId = link.replace("epayco_session:", "");
        logStep("Proveedor ePayco: abrir checkout", JSON.stringify({ sessionId }));
        const scriptId = "epayco-checkout";
        if (!document.getElementById(scriptId)) {
          const s = document.createElement("script");
          s.id = scriptId;
          s.src = "https://checkout.epayco.co/checkout.js";
          s.async = true;
          document.body.appendChild(s);
          await new Promise<void>((resolve, reject) => {
            s.onload = () => resolve();
            s.onerror = () => reject(new Error("No se pudo cargar checkout ePayco"));
          });
        }
        // @ts-expect-error epayco global
        const checkout = window.ePayco.checkout.configure({
          sessionId,
          type: "standard",
          test: true,
        });
        checkout.open();
        setInfo("Se abrió ePayco. Cuando se confirme por webhook, refresca esta página.");
        logStep("Checkout ePayco abierto", "Esperando confirmación por webhook");
        setPendingPayment({ paymentId, targetKind, targetId });
      } else {
        logStep("Proveedor link externo: abrir", link);
        window.open(link, "_blank", "noopener,noreferrer");
        setInfo("Se abrió el link de pago. Cuando el pago se confirme por webhook, refresca esta página.");
        logStep("Link de pago abierto", "Esperando confirmación por webhook");
        setPendingPayment({ paymentId, targetKind, targetId });
      }
    } catch (e: any) {
      setError(e?.response?.data?.detail ?? "No se pudo iniciar el pago");
      logStep("Error iniciando pago", e?.response?.data?.detail ?? String(e));
    } finally {
      setLoading(false);
    }
  }

  // Polling: si el pago queda pendiente (webhook), refresca hasta confirmar
  useEffect(() => {
    if (!pendingPayment) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const p = await payments.get(`/payments/${pendingPayment.paymentId}`);
        logStep("Polling payments/{id}", JSON.stringify({ status: p.data.status }));
        if (p.data.status === "confirmed" || p.data.status === "failed") {
          await refreshAll();
          if (!cancelled) setPendingPayment(null);
        }
      } catch (e: any) {
        logStep("Polling error", e?.response?.data?.detail ?? String(e));
      }
    };
    const id = window.setInterval(() => tick(), 3000);
    tick();
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [pendingPayment]);

  async function download(invoiceId: string, kind: "pdf" | "xml") {
    setError(null);
    try {
      logStep(`GET invoices/{id}/${kind}: descargar`, invoiceId);
      const r = await backend.get(`/invoices/${invoiceId}/${kind}`, { responseType: "blob" });
      const size = (r.data as Blob).size ?? 0;
      logStep("Descarga OK", JSON.stringify({ content_type: r.headers["content-type"], bytes: size }));
      const contentType = r.headers["content-type"];
      const mime = typeof contentType === "string" ? contentType : "application/octet-stream";
      const blob = new Blob([r.data], { type: mime });
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank", "noopener,noreferrer");
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
    } catch (e: any) {
      setError(e?.response?.data?.detail ?? `No se pudo descargar ${kind.toUpperCase()}`);
      logStep("Error descargando", e?.response?.data?.detail ?? String(e));
    }
  }

  async function reserveParking() {
    if (!parkingAmenityId) {
      setError("Selecciona un parqueadero disponible.");
      return;
    }
    if (!parkingStart || !parkingEnd) {
      setError("Selecciona la hora de inicio y de fin.");
      return;
    }
    const startDate = new Date(parkingStart);
    const endDate = new Date(parkingEnd);
    if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
      setError("Las fechas seleccionadas no son válidas.");
      return;
    }
    if (endDate <= startDate) {
      setError("La hora de fin debe ser posterior a la hora de inicio.");
      return;
    }
    setLoading(true);
    setError(null);
    setInfo(null);
    try {
      const startISO = startDate.toISOString();
      const endISO = endDate.toISOString();
      logStep("POST reservations (parqueadero)", JSON.stringify({ amenity_id: parkingAmenityId, start_at: startISO, end_at: endISO }));
      const r = await backend.post("/reservations", {
        amenity_id: parkingAmenityId,
        start_at: startISO,
        end_at: endISO,
      });
      logStep("Reserva creada", JSON.stringify({ id: r.data._id, amount_cop: r.data.amount_cop }));
      setInfo(`Reserva creada por $${Number(r.data.amount_cop).toLocaleString("es-CO")}. Iniciando pago…`);
      setParkingStart("");
      setParkingEnd("");
      await refreshAll();
      await pay("reservation", r.data._id);
    } catch (e: any) {
      setError(e?.response?.data?.detail ?? "No se pudo crear la reserva");
    } finally {
      setLoading(false);
    }
  }

  async function reserveHall() {
    if (!hallAmenityId) {
      setError("Selecciona un salón comunal.");
      return;
    }
    if (!hallDate) {
      setError("Selecciona la fecha del evento.");
      return;
    }
    setLoading(true);
    setError(null);
    setInfo(null);
    try {
      const start = new Date(`${hallDate}T00:00:00`);
      const end = new Date(`${hallDate}T23:59:00`);
      logStep("POST reservations (salón)", JSON.stringify({ amenity_id: hallAmenityId, date: hallDate }));
      const r = await backend.post("/reservations", {
        amenity_id: hallAmenityId,
        start_at: start.toISOString(),
        end_at: end.toISOString(),
      });
      logStep("Reserva creada", JSON.stringify({ id: r.data._id, amount_cop: r.data.amount_cop }));
      setInfo(`Reserva creada por $${Number(r.data.amount_cop).toLocaleString("es-CO")}. Iniciando pago…`);
      setHallDate("");
      await refreshAll();
      await pay("reservation", r.data._id);
    } catch (e: any) {
      setError(e?.response?.data?.detail ?? "No se pudo crear la reserva");
    } finally {
      setLoading(false);
    }
  }

  async function cancelReservation(id: string) {
    if (!confirm("¿Cancelar esta reserva?")) return;
    setLoading(true);
    setError(null);
    try {
      logStep("POST reservations/{id}/cancel", id);
      await backend.post(`/reservations/${id}/cancel`);
      setInfo("Reserva cancelada.");
      await refreshAll();
    } catch (e: any) {
      setError(e?.response?.data?.detail ?? "No se pudo cancelar");
    } finally {
      setLoading(false);
    }
  }

  async function subscribeGymAndPay() {
    setLoading(true);
    setError(null);
    setInfo(null);
    try {
      logStep("POST gym/subscriptions", JSON.stringify({ period }));
      const r = await backend.post("/gym/subscriptions", { period });
      logStep("Suscripción lista", JSON.stringify({ id: r.data._id, amount_cop: r.data.amount_cop, status: r.data.status }));
      await refreshAll();
      if (r.data.status === "Pagada") {
        setInfo("Tu suscripción de este mes ya está pagada.");
        return;
      }
      await pay("gym_subscription", r.data._id);
    } catch (e: any) {
      setError(e?.response?.data?.detail ?? "No se pudo crear la suscripción");
    } finally {
      setLoading(false);
    }
  }

  const TAB_META: Record<Tab, { title: string; subtitle: string }> = {
    facturas: {
      title: "Mis facturas",
      subtitle: "Cuotas de administración pendientes y pagadas.",
    },
    parqueadero: {
      title: "Parqueadero de visitantes",
      subtitle: "Reserva por horas para tus invitados.",
    },
    salon: {
      title: "Salón comunal",
      subtitle: "Reserva el salón para tus eventos.",
    },
    gimnasio: {
      title: "Gimnasio",
      subtitle: "Suscripción mensual al gimnasio del conjunto.",
    },
  };
  const tabMeta = TAB_META[tab];

  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <h2 data-testid="resident-dashboard-title" className="text-xl font-bold tracking-tight text-app-text sm:text-2xl">
          {tabMeta.title}
        </h2>
        <p className="max-w-xl text-sm text-app-muted">{tabMeta.subtitle}</p>
      </div>

      {error && (
        <div className="rounded-2xl border border-app-danger-border bg-app-danger-bg p-4 text-sm text-app-danger-text">{error}</div>
      )}
      {info && (
        <div className="rounded-2xl border border-app-success-border bg-app-success-bg p-4 text-sm text-app-success-text">{info}</div>
      )}
      {pendingPayment && (
        <div className="rounded-2xl border border-app-warning-border bg-app-warning-bg p-4 text-sm leading-relaxed text-app-warning-text">
          Pago pendiente de confirmación. Estamos actualizando automáticamente…
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <ConsumptionBars
          title="Mi consumo pagado"
          subtitle="Clic en una barra para abrir esa sección."
          items={consumption}
          totalLabel="Total pagado"
          emptyLabel="Aún no has pagado servicios. Cuando lo hagas, verás el desglose aquí."
          onSelect={(key) => setTab(key as Tab)}
        />
        <ConsumptionBars
          title="Pendiente por pagar"
          subtitle="Saldos abiertos por concepto."
          items={pending}
          totalLabel="Total pendiente"
          emptyLabel="¡Estás al día! No tienes saldos pendientes."
          onSelect={(key) => setTab(key as Tab)}
        />
      </div>

      {import.meta.env.DEV && (
        <Card>
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-semibold">Pasarela (demo)</div>
              <div className="text-sm text-app-muted">En dev puedes elegir proveedor para probar el flujo.</div>
            </div>
            <select
              value={gateway}
              onChange={(e) => setGateway(e.target.value as any)}
              className="rounded-xl border border-app-border bg-app-surface px-3 py-2 text-xs text-app-text outline-none focus-visible:ring-2 focus-visible:ring-app-cyan/35"
            >
              <option value="auto">Auto (config servidor)</option>
              <option value="mock">Mock</option>
              <option value="wompi">Wompi</option>
              <option value="epayco">ePayco</option>
            </select>
          </div>
        </Card>
      )}

      {tab === "facturas" && (
        <Card>
          <div className="overflow-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-app-muted">
                <tr>
                  <th className="py-3">Periodo</th>
                  <th className="py-3">Vence</th>
                  <th className="py-3">Valor</th>
                  <th className="py-3">Estado</th>
                  <th className="py-3 text-right">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((i) => (
                  <tr key={i._id} className="border-t border-app-border">
                    <td className="py-3">{i.period}</td>
                    <td className="py-3">{new Date(i.due_date).toLocaleDateString("es-CO")}</td>
                    <td className="py-3">${i.amount_cop.toLocaleString("es-CO")}</td>
                    <td className="py-3">{i.status}</td>
                    <td className="py-3 text-right">
                      <div className="flex flex-wrap justify-end gap-2">
                        {(i.pdf_url || i.factus_public_url) && (
                          <button
                            type="button"
                            className="text-xs font-medium text-app-cyan hover:brightness-125"
                            onClick={() => download(i._id, "pdf")}
                          >
                            PDF
                          </button>
                        )}
                        {i.xml_url && (
                          <button
                            type="button"
                            className="text-xs font-medium text-app-cyan hover:brightness-125"
                            onClick={() => download(i._id, "xml")}
                          >
                            XML
                          </button>
                        )}
                        <Button
                          disabled={loading || i.status === "Pagada"}
                          onClick={() => pay("invoice", i._id)}
                          className="px-3 py-1 text-xs"
                        >
                          {i.status === "Pagada" ? "Pagada" : "Pagar"}
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
                {invoices.length === 0 && (
                  <tr>
                    <td className="py-4 text-app-muted" colSpan={5}>
                      No tienes facturas aún.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {tab === "parqueadero" && (
        <div className="space-y-6">
          <Card>
            <div className="space-y-4">
              <div>
                <div className="text-base font-semibold text-app-text">Reservar parqueadero de visitantes</div>
                <div className="text-sm text-app-muted">Selecciona un parqueadero disponible y el rango horario.</div>
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <select
                  data-testid="parking-amenity"
                  value={parkingAmenityId}
                  onChange={(e) => setParkingAmenityId(e.target.value)}
                  className="rounded-xl border border-app-border bg-app-surface px-3 py-2 text-sm text-app-text outline-none focus-visible:ring-2 focus-visible:ring-app-cyan/35"
                >
                  <option value="">— Parqueadero —</option>
                  {parkings.map((p) => (
                    <option key={p._id} value={p._id}>
                      {p.code}
                    </option>
                  ))}
                </select>
                <input
                  data-testid="parking-start"
                  type="datetime-local"
                  value={parkingStart}
                  onChange={(e) => setParkingStart(e.target.value)}
                  min={formatLocalDateTime(new Date())}
                  className="rounded-xl border border-app-border bg-app-surface px-3 py-2 text-sm text-app-text outline-none focus-visible:ring-2 focus-visible:ring-app-cyan/35"
                />
                <input
                  data-testid="parking-end"
                  type="datetime-local"
                  value={parkingEnd}
                  onChange={(e) => setParkingEnd(e.target.value)}
                  min={parkingStart || formatLocalDateTime(new Date())}
                  className="rounded-xl border border-app-border bg-app-surface px-3 py-2 text-sm text-app-text outline-none focus-visible:ring-2 focus-visible:ring-app-cyan/35"
                />
              </div>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="text-sm text-app-muted">
                  {parkingEstimate ? (
                    <>
                      Estimado: <span className="font-semibold text-app-text">${parkingEstimate.amount.toLocaleString("es-CO")}</span>{" "}
                      ({parkingEstimate.hours} h × ${PARKING_HOURLY_COP.toLocaleString("es-CO")})
                    </>
                  ) : (
                    "Selecciona inicio y fin para ver el valor."
                  )}
                </div>
                <Button
                  data-testid="parking-reserve"
                  disabled={loading || !parkingAmenityId || !parkingStart || !parkingEnd}
                  onClick={reserveParking}
                >
                  {loading ? "Procesando…" : "Reservar y pagar"}
                </Button>
              </div>
            </div>
          </Card>

          <Card>
            <div className="mb-3 text-base font-semibold text-app-text">Mis reservas de parqueadero</div>
            <div className="overflow-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-app-muted">
                  <tr>
                    <th className="py-3">Parqueadero</th>
                    <th className="py-3">Inicio</th>
                    <th className="py-3">Fin</th>
                    <th className="py-3">Valor</th>
                    <th className="py-3">PIN</th>
                    <th className="py-3">Estado</th>
                    <th className="py-3 text-right">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {reservations
                    .filter((r) => r.amenity_type === "visitor_parking")
                    .map((r) => (
                      <tr key={r._id} className="border-t border-app-border">
                        <td className="py-3">{r.amenity_code}</td>
                        <td className="py-3">{new Date(r.start_at).toLocaleString("es-CO")}</td>
                        <td className="py-3">{new Date(r.end_at).toLocaleString("es-CO")}</td>
                        <td className="py-3">${r.amount_cop.toLocaleString("es-CO")}</td>
                        <td className="py-3">
                          {r.status === "Pagada" && r.access_pin ? (
                            <span className="rounded-lg border border-app-border bg-app-elevated px-2 py-1 font-mono text-xs text-app-text">
                              {r.access_pin}
                            </span>
                          ) : (
                            <span className="text-xs text-app-muted">Al pagar</span>
                          )}
                        </td>
                        <td className="py-3">{r.status}</td>
                        <td className="py-3 text-right">
                          <div className="flex flex-wrap justify-end gap-2">
                            {r.status === "Pendiente" && (
                              <>
                                <Button disabled={loading} onClick={() => pay("reservation", r._id)} className="px-3 py-1 text-xs">
                                  Pagar
                                </Button>
                                <button
                                  type="button"
                                  className="text-xs text-app-danger-text hover:opacity-80"
                                  onClick={() => cancelReservation(r._id)}
                                >
                                  Cancelar
                                </button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  {reservations.filter((r) => r.amenity_type === "visitor_parking").length === 0 && (
                    <tr>
                      <td className="py-4 text-app-muted" colSpan={7}>
                        Sin reservas aún.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}

      {tab === "salon" && (
        <div className="space-y-6">
          <Card>
            <div className="space-y-4">
              <div>
                <div className="text-base font-semibold text-app-text">Reservar salón comunal</div>
                <div className="text-sm text-app-muted">Reserva por día calendario.</div>
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <select
                  data-testid="hall-amenity"
                  value={hallAmenityId}
                  onChange={(e) => setHallAmenityId(e.target.value)}
                  className="rounded-xl border border-app-border bg-app-surface px-3 py-2 text-sm text-app-text outline-none focus-visible:ring-2 focus-visible:ring-app-cyan/35"
                >
                  <option value="">— Salón —</option>
                  {halls.map((h) => (
                    <option key={h._id} value={h._id}>
                      {h.code}
                    </option>
                  ))}
                </select>
                <input
                  data-testid="hall-date"
                  type="date"
                  value={hallDate}
                  onChange={(e) => setHallDate(e.target.value)}
                  min={formatLocalDate(new Date())}
                  className="rounded-xl border border-app-border bg-app-surface px-3 py-2 text-sm text-app-text outline-none focus-visible:ring-2 focus-visible:ring-app-cyan/35"
                />
              </div>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="text-sm text-app-muted">
                  {hallEstimate ? (
                    <>
                      Estimado: <span className="font-semibold text-app-text">${hallEstimate.amount.toLocaleString("es-CO")}</span>{" "}
                      (1 día)
                    </>
                  ) : (
                    "Selecciona la fecha para ver el valor."
                  )}
                </div>
                <Button
                  data-testid="hall-reserve"
                  disabled={loading || !hallAmenityId || !hallDate}
                  onClick={reserveHall}
                >
                  {loading ? "Procesando…" : "Reservar y pagar"}
                </Button>
              </div>
            </div>
          </Card>

          <Card>
            <div className="mb-3 text-base font-semibold text-app-text">Mis reservas del salón</div>
            <div className="overflow-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-app-muted">
                  <tr>
                    <th className="py-3">Salón</th>
                    <th className="py-3">Fecha</th>
                    <th className="py-3">Valor</th>
                    <th className="py-3">Estado</th>
                    <th className="py-3 text-right">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {reservations
                    .filter((r) => r.amenity_type === "social_hall")
                    .map((r) => (
                      <tr key={r._id} className="border-t border-app-border">
                        <td className="py-3">{r.amenity_code}</td>
                        <td className="py-3">{new Date(r.start_at).toLocaleDateString("es-CO")}</td>
                        <td className="py-3">${r.amount_cop.toLocaleString("es-CO")}</td>
                        <td className="py-3">{r.status}</td>
                        <td className="py-3 text-right">
                          <div className="flex flex-wrap justify-end gap-2">
                            {r.status === "Pendiente" && (
                              <>
                                <Button disabled={loading} onClick={() => pay("reservation", r._id)} className="px-3 py-1 text-xs">
                                  Pagar
                                </Button>
                                <button
                                  type="button"
                                  className="text-xs text-app-danger-text hover:opacity-80"
                                  onClick={() => cancelReservation(r._id)}
                                >
                                  Cancelar
                                </button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  {reservations.filter((r) => r.amenity_type === "social_hall").length === 0 && (
                    <tr>
                      <td className="py-4 text-app-muted" colSpan={5}>
                        Sin reservas aún.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}

      {tab === "gimnasio" && (
        <div className="space-y-6">
          <Card>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="text-base font-semibold text-app-text">Gimnasio — periodo {period}</div>
                <div className="text-sm text-app-muted">
                  {gymCurrent
                    ? gymCurrent.status === "Pagada"
                      ? "Ya está pagada para este mes."
                      : `Suscripción creada por $${gymCurrent.amount_cop.toLocaleString("es-CO")}. Pendiente de pago.`
                    : "Aún no tienes suscripción para este mes."}
                </div>
              </div>
              <Button
                data-testid="gym-subscribe"
                disabled={loading || gymCurrent?.status === "Pagada"}
                onClick={subscribeGymAndPay}
              >
                {loading
                  ? "Procesando…"
                  : gymCurrent?.status === "Pagada"
                    ? "Pagada"
                    : gymCurrent
                      ? "Pagar"
                      : "Suscribirme y pagar"}
              </Button>
            </div>
          </Card>

          <Card>
            <div className="mb-3 text-base font-semibold text-app-text">Historial</div>
            <div className="overflow-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-app-muted">
                  <tr>
                    <th className="py-3">Periodo</th>
                    <th className="py-3">Valor</th>
                    <th className="py-3">Estado</th>
                    <th className="py-3 text-right">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {gymSubs.map((s) => (
                    <tr key={s._id} className="border-t border-app-border">
                      <td className="py-3">{s.period}</td>
                      <td className="py-3">${s.amount_cop.toLocaleString("es-CO")}</td>
                      <td className="py-3">{s.status}</td>
                      <td className="py-3 text-right">
                        {s.status === "Pendiente" && (
                          <Button disabled={loading} onClick={() => pay("gym_subscription", s._id)} className="px-3 py-1 text-xs">
                            Pagar
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                  {gymSubs.length === 0 && (
                    <tr>
                      <td className="py-4 text-app-muted" colSpan={4}>
                        Sin suscripciones aún.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}

      <Card>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-1">
            <div className="text-base font-semibold text-app-text">Proceso (API)</div>
            <div className="text-sm text-app-muted">Registro de llamadas y respuestas más recientes.</div>
          </div>
          <button
            type="button"
            className="shrink-0 rounded-xl border border-app-border bg-app-elevated px-4 py-2 text-sm text-app-text hover:bg-app-elevated"
            onClick={() => setShowProcess((v) => !v)}
          >
            {showProcess ? "Ocultar" : "Mostrar"}
          </button>
        </div>
        {showProcess && (
          <div className="mt-5 space-y-3 text-sm">
            {steps.length === 0 && (
              <div className="text-app-muted">Aún no hay acciones. Reserva, paga o descarga PDF/XML.</div>
            )}
            {steps.map((s, idx) => (
              <div key={idx} className="rounded-xl border border-app-border bg-app-surface px-4 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="font-semibold text-app-text">{s.title}</div>
                  <div className="text-xs text-app-muted">{s.at}</div>
                </div>
                {s.detail && (
                  <pre className="mt-2 whitespace-pre-wrap break-words text-sm text-app-text">{s.detail}</pre>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
