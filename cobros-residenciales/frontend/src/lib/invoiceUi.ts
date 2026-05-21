export type InvoiceRow = {
  _id: string;
  unit_id: string;
  period: string;
  amount_cop: number;
  status: string;
  due_date: string;
  factus_error?: string | null;
  factus_invoice_id?: string | null;
  factus_number?: string | null;
  factus_cufe?: string | null;
  pdf_url?: string | null;
  xml_url?: string | null;
};

export type FactusStatusRow = {
  factus_error?: string | null;
  factus_number?: string | null;
  factus_cufe?: string | null;
};

export function factusRowStatus(i: FactusStatusRow): { label: string; className: string; title?: string } {
  if (i.factus_number || i.factus_cufe) {
    return {
      label: "Emitida",
      className: "font-medium text-emerald-700 dark:text-emerald-300",
      title: i.factus_number ?? undefined,
    };
  }
  if (i.factus_error) {
    return {
      label: "Error",
      className: "font-medium text-amber-700 dark:text-amber-300",
      title: i.factus_error,
    };
  }
  return { label: "Pendiente", className: "text-app-muted" };
}
