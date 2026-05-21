import type { BillingKind } from "./billing";

/** Mensaje legible desde `detail` de FastAPI (string o lista de validación). */
export function formatApiDetail(detail: unknown): string {
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail))
    return detail.map((x: { msg?: string }) => x?.msg ?? JSON.stringify(x)).join(" ");
  return "No se pudo completar la solicitud.";
}

/** Con `responseType: "blob"`, los errores JSON llegan como Blob; hay que parsearlos. */
export async function detailFromAxiosError(e: unknown): Promise<string | undefined> {
  if (!e || typeof e !== "object" || !("response" in e)) return undefined;
  const res = (e as { response?: { data?: unknown; status?: number } }).response;
  if (!res) return undefined;
  const { data, status } = res;
  if (data instanceof Blob) {
    try {
      const text = await data.text();
      const json = JSON.parse(text) as { detail?: unknown };
      return formatApiDetail(json.detail);
    } catch {
      if (status === 404) return "Archivo no encontrado.";
      if (status === 502) return "No se pudo obtener el archivo desde Factus.";
      return undefined;
    }
  }
  if (data && typeof data === "object" && "detail" in (data as object)) {
    return formatApiDetail((data as { detail?: unknown }).detail);
  }
  return undefined;
}

export async function downloadBillingBlob(
  get: (url: string, config: { responseType: "blob" }) => Promise<{ data: Blob; headers: Record<string, unknown> }>,
  billingKind: BillingKind,
  docId: string,
  fileKind: "pdf" | "xml",
): Promise<void> {
  const r = await get(`/billing/${billingKind}/${docId}/${fileKind}`, { responseType: "blob" });
  const mime = (r.headers["content-type"] as string) || "application/octet-stream";
  const blob = new Blob([r.data], { type: mime });
  const url = URL.createObjectURL(blob);
  window.open(url, "_blank", "noopener,noreferrer");
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export async function downloadInvoiceBlob(
  get: (url: string, config: { responseType: "blob" }) => Promise<{ data: Blob; headers: Record<string, unknown> }>,
  invoiceId: string,
  kind: "pdf" | "xml",
): Promise<void> {
  return downloadBillingBlob(get, "invoice", invoiceId, kind);
}
