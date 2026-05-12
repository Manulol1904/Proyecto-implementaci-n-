import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

/**
 * Sections shared between the sidebar (App.tsx) and the dashboards.
 * Each value maps to a panel rendered by AdminDashboard / ResidentDashboard.
 */
export type AdminSection =
  | "usuarios"
  | "unidades"
  | "facturas"
  | "amenidades"
  | "reservas"
  | "gimnasio";

export type ResidentSection = "facturas" | "parqueadero" | "salon" | "gimnasio";

export type AppSection = AdminSection | ResidentSection;

type Ctx = {
  section: AppSection;
  setSection: (s: AppSection) => void;
};

const SectionContext = createContext<Ctx | null>(null);

export function SectionProvider({
  initial,
  children,
}: {
  initial: AppSection;
  children: ReactNode;
}) {
  const [section, setSection] = useState<AppSection>(initial);
  const value = useMemo(() => ({ section, setSection }), [section]);
  return <SectionContext.Provider value={value}>{children}</SectionContext.Provider>;
}

export function useSection(): Ctx {
  const ctx = useContext(SectionContext);
  if (!ctx) {
    throw new Error("useSection must be used inside <SectionProvider>");
  }
  return ctx;
}
