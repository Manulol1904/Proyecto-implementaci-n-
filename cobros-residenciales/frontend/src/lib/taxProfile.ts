export type TaxProfile = {
  identification_document_id: number;
  identification: string;
  names: string;
  address: string;
  email: string;
  phone: string;
  municipality_id: number;
  legal_organization_code?: string;
  tribute_code?: string;
};

export const DOC_TYPE_OPTIONS = [
  { id: 3, label: "Cédula de ciudadanía" },
  { id: 5, label: "Cédula de extranjería" },
  { id: 6, label: "NIT" },
] as const;

export function defaultTaxProfile(email: string, fullName: string): TaxProfile {
  return {
    identification_document_id: 3,
    identification: "",
    names: fullName,
    address: "",
    email,
    phone: "",
    municipality_id: 11001,
    legal_organization_code: "2",
    tribute_code: "ZZ",
  };
}

export function taxProfileFromUser(raw: Record<string, unknown> | null | undefined, email: string, fullName: string): TaxProfile {
  const base = defaultTaxProfile(email, fullName);
  if (!raw) return base;
  return {
    ...base,
    identification_document_id: Number(raw.identification_document_id ?? base.identification_document_id),
    identification: String(raw.identification ?? ""),
    names: String(raw.names ?? fullName),
    address: String(raw.address ?? ""),
    email: String(raw.email ?? email),
    phone: String(raw.phone ?? ""),
    municipality_id: Number(raw.municipality_id ?? 11001),
    legal_organization_code: String(raw.legal_organization_code ?? "2"),
    tribute_code: String(raw.tribute_code ?? "ZZ"),
  };
}

export function isTaxProfileComplete(tp: TaxProfile): boolean {
  return Boolean(
    tp.identification &&
      tp.names &&
      tp.address &&
      tp.email &&
      tp.phone &&
      tp.municipality_id > 0,
  );
}
