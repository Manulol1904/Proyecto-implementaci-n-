import { useCallback, useEffect, useState } from "react";
import { backend, payments } from "../lib/api";
import type { BillingDocument } from "../lib/billing";
import { factusRowStatus } from "../lib/invoiceUi";
import {
  defaultTaxProfile,
  isTaxProfileComplete,
  taxProfileFromUser,
  type TaxProfile,
  DOC_TYPE_OPTIONS,
} from "../lib/taxProfile";
import type { Me } from "../lib/auth";
import { detailFromAxiosError, downloadBillingBlob, formatApiDetail } from "../lib/apiErrors";
import Button from "./Button";
import Card from "./Card";

type Unit = { _id: string; code: string; coefficient: number };

type ProfileData = {
  user: Me & { tax_profile?: Record<string, unknown> | null };
  units: Unit[];
  factus_configured: boolean;
  billing_documents?: BillingDocument[];
  invoices?: Array<{
    _id: string;
    period: string;
    amount_cop: number;
    status: string;
    created_at: string;
    paid_at?: string | null;
    factus_error?: string | null;
    factus_number?: string | null;
    factus_cufe?: string | null;
    pdf_url?: string | null;
    xml_url?: string | null;
  }>;
};

export default function ProfilePanel({
  me,
  role,
  onMeUpdated,
}: {
  me: Me;
  role: "admin" | "resident";
  onMeUpdated?: (next: Me) => void;
}) {
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const [fullName, setFullName] = useState(me.full_name);
  const [email, setEmail] = useState(me.email);
  const [tax, setTax] = useState<TaxProfile>(() => defaultTaxProfile(me.email, me.full_name));
  const [currentPwd, setCurrentPwd] = useState("");
  const [newPwd, setNewPwd] = useState("");

  const [units, setUnits] = useState<Unit[]>([]);
  const [factusConfigured, setFactusConfigured] = useState(false);
  const [billingDocs, setBillingDocs] = useState<BillingDocument[]>([]);

  const loadProfile = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await backend.get<ProfileData>("/profile");
      const u = r.data.user;
      setFullName(u.full_name);
      setEmail(u.email);
      setTax(taxProfileFromUser(u.tax_profile as Record<string, unknown> | null, u.email, u.full_name));
      setUnits(r.data.units ?? []);
      setFactusConfigured(r.data.factus_configured);
      setBillingDocs(
        (r.data.billing_documents?.length ? r.data.billing_documents : r.data.invoices?.map((inv) => ({
          id: inv._id,
          kind: "invoice" as const,
          label: `Administración ${inv.period}`,
          category: "Administración",
          period: inv.period,
          amount_cop: inv.amount_cop,
          status: inv.status,
          created_at: inv.created_at,
          paid_at: inv.paid_at,
          factus_error: inv.factus_error,
          factus_number: inv.factus_number,
          factus_cufe: inv.factus_cufe,
          pdf_url: inv.pdf_url,
          xml_url: inv.xml_url,
        }))) ?? [],
      );
      onMeUpdated?.({
        _id: u._id,
        email: u.email,
        full_name: u.full_name,
        role: u.role as Me["role"],
        created_at: u.created_at,
        tax_profile: u.tax_profile,
      });
    } catch (e: unknown) {
      const detail =
        e && typeof e === "object" && "response" in e
          ? (e as { response?: { data?: { detail?: unknown } } }).response?.data?.detail
          : undefined;
      setError(formatApiDetail(detail));
    } finally {
      setLoading(false);
    }
  }, [onMeUpdated]);

  useEffect(() => {
    void loadProfile();
  }, [loadProfile]);

  async function saveAccount() {
    setError(null);
    setInfo(null);
    try {
      await backend.patch("/profile", { full_name: fullName, email });
      setInfo("Datos de cuenta actualizados.");
      await loadProfile();
    } catch (e: unknown) {
      const detail =
        e && typeof e === "object" && "response" in e
          ? (e as { response?: { data?: { detail?: unknown } } }).response?.data?.detail
          : undefined;
      setError(formatApiDetail(detail));
    }
  }

  async function saveTaxProfile() {
    setError(null);
    setInfo(null);
    if (!isTaxProfileComplete(tax)) {
      setError("Completa todos los campos del perfil fiscal para Factus.");
      return;
    }
    try {
      await backend.patch("/profile", { tax_profile: tax });
      setInfo("Perfil fiscal guardado. Ya puedes emitir facturas electrónicas.");
      await loadProfile();
    } catch (e: unknown) {
      const detail =
        e && typeof e === "object" && "response" in e
          ? (e as { response?: { data?: { detail?: unknown } } }).response?.data?.detail
          : undefined;
      setError(formatApiDetail(detail));
    }
  }

  async function changePassword() {
    setError(null);
    setInfo(null);
    try {
      await backend.post("/profile/change-password", {
        current_password: currentPwd,
        new_password: newPwd,
      });
      setCurrentPwd("");
      setNewPwd("");
      setInfo("Contraseña actualizada.");
    } catch (e: unknown) {
      const detail =
        e && typeof e === "object" && "response" in e
          ? (e as { response?: { data?: { detail?: unknown } } }).response?.data?.detail
          : undefined;
      setError(formatApiDetail(detail));
    }
  }

  async function retryFactus(kind: BillingDocument["kind"], docId: string) {
    setBusyId(docId);
    setError(null);
    try {
      await backend.post(`/billing/${kind}/${docId}/retry-factus`);
      setInfo("Emitiendo factura en Factus…");
      for (let n = 0; n < 5; n++) {
        await new Promise((r) => setTimeout(r, 2000));
        const r = await backend.get<ProfileData>("/profile");
        const doc = (r.data.billing_documents ?? []).find((d) => d.id === docId && d.kind === kind);
        setBillingDocs(r.data.billing_documents ?? []);
        if (doc?.factus_number || doc?.factus_cufe) {
          setInfo(`Factura electrónica emitida: ${doc.factus_number ?? "OK"}`);
          break;
        }
        if (doc?.factus_error && n === 4) setError(`Factus: ${doc.factus_error}`);
      }
    } catch (e: unknown) {
      const detail =
        e && typeof e === "object" && "response" in e
          ? (e as { response?: { data?: { detail?: unknown } } }).response?.data?.detail
          : undefined;
      setError(formatApiDetail(detail));
    } finally {
      setBusyId(null);
    }
  }

  async function downloadFile(doc: BillingDocument, fileKind: "pdf" | "xml") {
    setBusyId(doc.id);
    setError(null);
    try {
      await downloadBillingBlob(
        (url, config) => backend.get(url, config),
        doc.kind,
        doc.id,
        fileKind,
      );
    } catch (e: unknown) {
      const msg = (await detailFromAxiosError(e)) ?? `No se pudo descargar ${fileKind.toUpperCase()}`;
      setError(msg);
    } finally {
      setBusyId(null);
    }
  }

  async function payDocument(doc: BillingDocument) {
    setBusyId(doc.id);
    setError(null);
    try {
      const r = await payments.post("/payments", { target_kind: doc.kind, target_id: doc.id });
      const paymentId = r.data.payment_id as string;
      await payments.post(`/mock/confirm/${paymentId}`);
      setInfo("Pago registrado. Generando factura electrónica…");
      await loadProfile();
    } catch (e: unknown) {
      const detail =
        e && typeof e === "object" && "response" in e
          ? (e as { response?: { data?: { detail?: unknown } } }).response?.data?.detail
          : undefined;
      setError(formatApiDetail(detail));
    } finally {
      setBusyId(null);
    }
  }

  const taxOk = isTaxProfileComplete(tax);

  if (loading && billingDocs.length === 0) {
    return (
      <div className="rounded-2xl border border-app-border bg-app-surface p-8 text-center text-app-muted">
        Cargando tu perfil…
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h2 className="text-xl font-bold text-app-text">Mi perfil</h2>
        <p className="text-sm text-app-muted">
          Aquí gestionas tu cuenta, datos fiscales para Factus y tus facturas electrónicas
          {role === "admin" ? " del conjunto" : ""}, sin ir a otras secciones.
        </p>
      </div>

      {error && (
        <div className="rounded-2xl border border-app-danger-border bg-app-danger-bg p-4 text-sm text-app-danger-text">
          {error}
        </div>
      )}
      {info && (
        <div className="rounded-2xl border border-app-success-border bg-app-success-bg p-4 text-sm text-app-success-text">
          {info}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <h3 className="text-sm font-semibold text-app-text">Datos de cuenta</h3>
          <div className="mt-4 space-y-3">
            <div>
              <label className="text-xs text-app-muted">Nombre completo</label>
              <input
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                className="mt-1 w-full rounded-xl border border-app-border bg-app-surface px-3 py-2 text-sm text-app-text outline-none focus-visible:ring-2 focus-visible:ring-app-cyan/35"
              />
            </div>
            <div>
              <label className="text-xs text-app-muted">Correo</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="mt-1 w-full rounded-xl border border-app-border bg-app-surface px-3 py-2 text-sm text-app-text outline-none focus-visible:ring-2 focus-visible:ring-app-cyan/35"
              />
            </div>
            <Button type="button" onClick={() => void saveAccount()} className="w-full sm:w-auto">
              Guardar cuenta
            </Button>
          </div>

          <div className="mt-6 border-t border-app-border pt-4">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-app-muted">Cambiar contraseña</h4>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <input
                type="password"
                placeholder="Contraseña actual"
                value={currentPwd}
                onChange={(e) => setCurrentPwd(e.target.value)}
                className="rounded-xl border border-app-border bg-app-surface px-3 py-2 text-sm text-app-text outline-none focus-visible:ring-2 focus-visible:ring-app-cyan/35"
              />
              <input
                type="password"
                placeholder="Nueva contraseña"
                value={newPwd}
                onChange={(e) => setNewPwd(e.target.value)}
                className="rounded-xl border border-app-border bg-app-surface px-3 py-2 text-sm text-app-text outline-none focus-visible:ring-2 focus-visible:ring-app-cyan/35"
              />
            </div>
            <Button type="button" onClick={() => void changePassword()} className="mt-3 px-3 py-1 text-xs">
              Actualizar contraseña
            </Button>
          </div>
        </Card>

        <Card>
          <div className="flex items-start justify-between gap-2">
            <div>
              <h3 className="text-sm font-semibold text-app-text">Perfil fiscal (Factus)</h3>
              <p className="mt-1 text-xs text-app-muted">Requerido para emitir factura electrónica DIAN.</p>
            </div>
            <span
              className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                taxOk
                  ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-300"
                  : "bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300"
              }`}
            >
              {taxOk ? "Completo" : "Incompleto"}
            </span>
          </div>
          <div className="mt-2 flex items-center gap-2 text-xs">
            <span
              className={
                factusConfigured
                  ? "font-medium text-emerald-700 dark:text-emerald-300"
                  : "font-medium text-amber-700 dark:text-amber-300"
              }
            >
              API Factus: {factusConfigured ? "conectada" : "no configurada en el servidor"}
            </span>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div>
              <label className="text-xs text-app-muted">Tipo documento</label>
              <select
                value={tax.identification_document_id}
                onChange={(e) => setTax((t) => ({ ...t, identification_document_id: Number(e.target.value) }))}
                className="mt-1 w-full rounded-xl border border-app-border bg-app-surface px-3 py-2 text-sm text-app-text outline-none focus-visible:ring-2 focus-visible:ring-app-cyan/35"
              >
                {DOC_TYPE_OPTIONS.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs text-app-muted">Número identificación</label>
              <input
                value={tax.identification}
                onChange={(e) => setTax((t) => ({ ...t, identification: e.target.value }))}
                className="mt-1 w-full rounded-xl border border-app-border bg-app-surface px-3 py-2 text-sm text-app-text outline-none focus-visible:ring-2 focus-visible:ring-app-cyan/35"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="text-xs text-app-muted">Nombre / razón social</label>
              <input
                value={tax.names}
                onChange={(e) => setTax((t) => ({ ...t, names: e.target.value }))}
                className="mt-1 w-full rounded-xl border border-app-border bg-app-surface px-3 py-2 text-sm text-app-text outline-none focus-visible:ring-2 focus-visible:ring-app-cyan/35"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="text-xs text-app-muted">Dirección</label>
              <input
                value={tax.address}
                onChange={(e) => setTax((t) => ({ ...t, address: e.target.value }))}
                className="mt-1 w-full rounded-xl border border-app-border bg-app-surface px-3 py-2 text-sm text-app-text outline-none focus-visible:ring-2 focus-visible:ring-app-cyan/35"
              />
            </div>
            <div>
              <label className="text-xs text-app-muted">Teléfono</label>
              <input
                value={tax.phone}
                onChange={(e) => setTax((t) => ({ ...t, phone: e.target.value }))}
                className="mt-1 w-full rounded-xl border border-app-border bg-app-surface px-3 py-2 text-sm text-app-text outline-none focus-visible:ring-2 focus-visible:ring-app-cyan/35"
              />
            </div>
            <div>
              <label className="text-xs text-app-muted">Municipio (código DIAN)</label>
              <input
                type="number"
                value={tax.municipality_id}
                onChange={(e) => setTax((t) => ({ ...t, municipality_id: Number(e.target.value) || 11001 }))}
                className="mt-1 w-full rounded-xl border border-app-border bg-app-surface px-3 py-2 text-sm text-app-text outline-none focus-visible:ring-2 focus-visible:ring-app-cyan/35"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="text-xs text-app-muted">Email facturación</label>
              <input
                type="email"
                value={tax.email}
                onChange={(e) => setTax((t) => ({ ...t, email: e.target.value }))}
                className="mt-1 w-full rounded-xl border border-app-border bg-app-surface px-3 py-2 text-sm text-app-text outline-none focus-visible:ring-2 focus-visible:ring-app-cyan/35"
              />
            </div>
          </div>
          <Button type="button" onClick={() => void saveTaxProfile()} className="mt-4 w-full sm:w-auto">
            Guardar perfil fiscal
          </Button>
        </Card>
      </div>

      {units.length > 0 && (
        <Card>
          <h3 className="text-sm font-semibold text-app-text">Mis unidades</h3>
          <ul className="mt-3 flex flex-wrap gap-2">
            {units.map((u) => (
              <li
                key={u._id}
                className="rounded-lg border border-app-border bg-app-elevated px-3 py-1.5 text-xs text-app-text"
              >
                {u.code} · coef. {u.coefficient}
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card>
        <h3 className="text-sm font-semibold text-app-text">
          {role === "admin" ? "Facturas electrónicas (todos los servicios)" : "Mis facturas electrónicas"}
        </h3>
        <p className="mt-1 text-xs text-app-muted">
          Administración, parqueadero, salón comunal y gimnasio. Emite, descarga PDF/XML y{" "}
          {role === "resident" ? "paga " : ""}reintenta ante Factus desde aquí.
        </p>
        <div className="mt-4 overflow-auto">
          <table className="w-full text-left text-xs">
            <thead className="text-app-muted">
              <tr>
                <th className="py-2">Tipo</th>
                <th className="py-2">Concepto</th>
                <th className="py-2">Valor</th>
                <th className="py-2">Estado</th>
                <th className="py-2">Factus</th>
                <th className="py-2 text-right">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {billingDocs.map((i) => {
                const fs = factusRowStatus(i);
                const rowBusy = busyId === i.id;
                const canEmit =
                  (!i.factus_number || i.factus_error) &&
                  (i.kind === "invoice" || i.status === "Pagada");
                const canPay = role === "resident" && i.status !== "Pagada";
                return (
                  <tr key={`${i.kind}-${i.id}`} className="border-t border-app-border">
                    <td className="py-2">{i.category}</td>
                    <td className="py-2" title={i.label}>
                      {i.label}
                    </td>
                    <td className="py-2">${i.amount_cop.toLocaleString("es-CO")}</td>
                    <td className="py-2">{i.status}</td>
                    <td className="py-2">
                      <span className={fs.className} title={fs.title}>
                        {fs.label}
                      </span>
                    </td>
                    <td className="py-2 text-right">
                      <div className="flex flex-wrap justify-end gap-1">
                        {canEmit && (
                          <Button
                            type="button"
                            disabled={rowBusy || !factusConfigured || !taxOk}
                            onClick={() => void retryFactus(i.kind, i.id)}
                            className="px-2 py-0.5 text-[10px]"
                            title={!taxOk ? "Completa perfil fiscal" : undefined}
                          >
                            {rowBusy ? "…" : "Emitir Factus"}
                          </Button>
                        )}
                        {(i.factus_number || i.pdf_url) && (
                          <Button
                            type="button"
                            variant="secondary"
                            disabled={rowBusy}
                            onClick={() => void downloadFile(i, "pdf")}
                            className="px-2 py-0.5 text-[10px]"
                          >
                            PDF
                          </Button>
                        )}
                        {(i.factus_number || i.xml_url) && (
                          <Button
                            type="button"
                            variant="secondary"
                            disabled={rowBusy}
                            onClick={() => void downloadFile(i, "xml")}
                            className="px-2 py-0.5 text-[10px]"
                          >
                            XML
                          </Button>
                        )}
                        {canPay && (
                          <Button
                            type="button"
                            disabled={rowBusy}
                            onClick={() => void payDocument(i)}
                            className="px-2 py-0.5 text-[10px]"
                          >
                            Pagar
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {billingDocs.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-4 text-app-muted">
                    {role === "resident"
                      ? "No tienes cobros registrados (administración, reservas o gimnasio)."
                      : "No hay cobros en el sistema."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
