export type BillingKind = "invoice" | "reservation" | "gym_subscription";

export type BillingDocument = {
  id: string;
  kind: BillingKind;
  label: string;
  category: string;
  period?: string | null;
  amount_cop: number;
  status: string;
  created_at: string;
  paid_at?: string | null;
  unit_code?: string | null;
  amenity_code?: string | null;
  factus_error?: string | null;
  factus_number?: string | null;
  factus_cufe?: string | null;
  pdf_url?: string | null;
  xml_url?: string | null;
};
