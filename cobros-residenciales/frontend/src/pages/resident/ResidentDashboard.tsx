import { useEffect, useState } from "react";
import Button from "../../components/Button";
import Card from "../../components/Card";
import { backend, payments } from "../../lib/api";

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

export default function ResidentDashboard() {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [showProcess, setShowProcess] = useState(false);
  const [steps, setSteps] = useState<Array<{ at: string; title: string; detail?: string }>>([]);
  const [gateway, setGateway] = useState<"auto" | "mock" | "wompi" | "epayco">("auto");
  const [pendingPayment, setPendingPayment] = useState<{ paymentId: string; invoiceId: string } | null>(null);

  function logStep(title: string, detail?: string) {
    setShowProcess(true);
    setSteps((s) => [{ at: new Date().toLocaleTimeString("es-CO"), title, detail }, ...s].slice(0, 40));
  }

  async function refresh() {
    const r = await backend.get("/invoices/my");
    setInvoices(r.data);
  }

  useEffect(() => {
    refresh().catch(() => setError("No se pudieron cargar tus facturas"));
  }, []);

  async function pay(invoiceId: string) {
    setLoading(true);
    setError(null);
    try {
      const payload: any = { invoice_id: invoiceId };
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

      // Demo UX: en dev, simula confirmación inmediata (sin webhooks externos)
      if (import.meta.env.DEV && provider !== "mock") {
        logStep("POST demo/confirm: simular confirmación", paymentId);
        await payments.post(`/demo/confirm/${paymentId}`);
        logStep("Confirmación demo aplicada", "Factura marcada como Pagada (demo)");
        await refresh();
        const inv = await backend.get(`/invoices/${invoiceId}`);
        logStep("GET invoices/{id}: estado final", JSON.stringify({ status: inv.data.status, paid_at: inv.data.paid_at }));
        return;
      }

      if (provider === "mock") {
        logStep("POST mock/confirm: simular confirmación", paymentId);
        await payments.post(`/mock/confirm/${paymentId}`);
        logStep("Confirmación mock aplicada", "Factura marcada como Pagada (mock)");
        await refresh();
        const inv = await backend.get(`/invoices/${invoiceId}`);
        logStep("GET invoices/{id}: estado final", JSON.stringify({ status: inv.data.status, paid_at: inv.data.paid_at }));
      } else if (provider === "epayco" && link.startsWith("epayco_session:")) {
        const sessionId = link.replace("epayco_session:", "");
        logStep("Proveedor ePayco: abrir checkout", JSON.stringify({ sessionId }));
        // Smart Checkout requiere script externo; lo cargamos bajo demanda.
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
        setError("Se abrió ePayco. Cuando se confirme por webhook, refresca esta página.");
        logStep("Checkout ePayco abierto", "Esperando confirmación por webhook");
        setPendingPayment({ paymentId, invoiceId });
      } else {
        logStep("Proveedor link externo: abrir", link);
        window.open(link, "_blank", "noopener,noreferrer");
        setError("Se abrió el link de pago. Cuando el pago se confirme por webhook, refresca esta página.");
        logStep("Link de pago abierto", "Esperando confirmación por webhook");
        setPendingPayment({ paymentId, invoiceId });
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
          await refresh();
          const inv = await backend.get(`/invoices/${pendingPayment.invoiceId}`);
          logStep("Polling invoices/{id}", JSON.stringify({ status: inv.data.status, paid_at: inv.data.paid_at }));
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
      const mime =
        typeof contentType === "string" ? contentType : "application/octet-stream";
      const blob = new Blob([r.data], { type: mime });
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank", "noopener,noreferrer");
      // best-effort cleanup
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
    } catch (e: any) {
      setError(e?.response?.data?.detail ?? `No se pudo descargar ${kind.toUpperCase()}`);
      logStep("Error descargando", e?.response?.data?.detail ?? String(e));
    }
  }

  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <h2 data-testid="resident-dashboard-title" className="text-xl font-bold tracking-tight text-app-cyan sm:text-2xl">
          Mis facturas
        </h2>
        <p className="max-w-xl text-sm text-app-muted">Consulta, descarga y paga en línea.</p>
      </div>

      {error && (
        <div className="rounded-2xl border border-rose-800/60 bg-rose-950/30 p-4 text-sm text-rose-100">{error}</div>
      )}
      {pendingPayment && (
        <div className="rounded-2xl border border-amber-800/60 bg-amber-950/25 p-4 text-sm leading-relaxed text-amber-100">
          Pago pendiente de confirmación. Estamos actualizando automáticamente…
        </div>
      )}

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
              className="rounded-xl border border-app-border bg-app-surface px-3 py-2 text-xs text-white outline-none focus-visible:ring-2 focus-visible:ring-app-cyan/35"
            >
              <option value="auto">Auto (config servidor)</option>
              <option value="mock">Mock</option>
              <option value="wompi">Wompi</option>
              <option value="epayco">ePayco</option>
            </select>
          </div>
        </Card>
      )}

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
                        onClick={() => pay(i._id)}
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

      <Card>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-1">
            <div className="text-base font-semibold text-white">Proceso (API)</div>
            <div className="text-sm text-app-muted">Registro de llamadas y respuestas más recientes.</div>
          </div>
          <button
            type="button"
            className="shrink-0 rounded-xl border border-app-border bg-app-elevated px-4 py-2 text-sm text-white/90 hover:bg-white/10"
            onClick={() => setShowProcess((v) => !v)}
          >
            {showProcess ? "Ocultar" : "Mostrar"}
          </button>
        </div>
        {showProcess && (
          <div className="mt-5 space-y-3 text-sm">
            {steps.length === 0 && (
              <div className="text-app-muted">Aún no hay acciones. Dale “Pagar” o descarga PDF/XML.</div>
            )}
            {steps.map((s, idx) => (
              <div key={idx} className="rounded-xl border border-app-border bg-app-surface px-4 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="font-semibold text-white">{s.title}</div>
                  <div className="text-xs text-app-muted">{s.at}</div>
                </div>
                {s.detail && (
                  <pre className="mt-2 whitespace-pre-wrap break-words text-sm text-white/90">{s.detail}</pre>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

