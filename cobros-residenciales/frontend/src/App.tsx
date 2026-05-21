import { useEffect, useMemo, useState } from "react";
import { Navigate, Route, Routes, useNavigate } from "react-router-dom";
import { backend } from "./lib/api";
import { clearToken, getToken, type Me } from "./lib/auth";
import { setAuthToken } from "./lib/api";
import { SectionProvider, useSection, type AppSection } from "./lib/section";
import { ThemeProvider, useTheme } from "./lib/theme";
import LoginPage from "./pages/LoginPage";
import AdminDashboard from "./pages/admin/AdminDashboard";
import ResidentDashboard from "./pages/resident/ResidentDashboard";
import ConnectionStatus from "./components/ConnectionStatus";

type NavItem = {
  id: AppSection;
  label: string;
  icon: JSX.Element;
};

const adminNav: NavItem[] = [
  { id: "perfil", label: "Mi perfil", icon: <IconProfile /> },
  { id: "facturas", label: "Facturas", icon: <IconInvoice /> },
  { id: "usuarios", label: "Usuarios", icon: <IconUsers /> },
  { id: "unidades", label: "Unidades", icon: <IconBuilding /> },
  { id: "amenidades", label: "Amenidades", icon: <IconAmenity /> },
  { id: "reservas", label: "Reservas", icon: <IconCalendar /> },
  { id: "gimnasio", label: "Gimnasio", icon: <IconGym /> },
];

const residentNav: NavItem[] = [
  { id: "perfil", label: "Mi perfil", icon: <IconProfile /> },
  { id: "facturas", label: "Mis facturas", icon: <IconInvoice /> },
  { id: "parqueadero", label: "Parqueadero", icon: <IconCar /> },
  { id: "salon", label: "Salón comunal", icon: <IconHall /> },
  { id: "gimnasio", label: "Gimnasio", icon: <IconGym /> },
];

const SECTION_TITLES: Record<AppSection, string> = {
  perfil: "Mi perfil",
  facturas: "Facturas",
  usuarios: "Usuarios",
  unidades: "Unidades",
  amenidades: "Amenidades",
  reservas: "Reservas",
  gimnasio: "Gimnasio",
  parqueadero: "Parqueadero de visitantes",
  salon: "Salón comunal",
};

function Sidebar({ items }: { items: NavItem[] }) {
  const { section, setSection } = useSection();
  return (
    <aside className="sidebar-scroll fixed inset-y-0 left-0 z-30 hidden w-64 flex-shrink-0 overflow-y-auto bg-app-sidebar text-app-sidebar-text shadow-2xl shadow-black/25 lg:block">
      <div className="flex h-16 items-center gap-3 px-6">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-app-primary text-white shadow-md">
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.2">
            <path d="M3 12L12 4l9 8" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M5 10v10h14V10" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        <div>
          <div className="text-sm font-semibold leading-tight text-white">Residencial</div>
          <div className="text-[11px] text-app-sidebar-muted">Cobros &amp; Reservas</div>
        </div>
      </div>

      <nav className="mt-4 space-y-1 px-3 pb-8">
        {items.map((item) => {
          const isActive = section === item.id;
          return (
            <button
              key={item.id}
              type="button"
              data-testid={`nav-${item.id}`}
              onClick={() => setSection(item.id)}
              aria-current={isActive ? "page" : undefined}
              className={`nav-item w-full ${isActive ? "nav-item-active" : ""}`}
            >
              <span className="text-current">{item.icon}</span>
              <span className="truncate">{item.label}</span>
            </button>
          );
        })}
      </nav>
    </aside>
  );
}

function MobileSectionPicker({ items }: { items: NavItem[] }) {
  const { section, setSection } = useSection();
  return (
    <div className="lg:hidden">
      <label className="sr-only" htmlFor="mobile-section">Sección</label>
      <select
        id="mobile-section"
        value={section}
        onChange={(e) => setSection(e.target.value as AppSection)}
        className="w-full rounded-xl border border-app-border bg-app-surface px-3 py-2.5 text-sm font-medium text-app-text shadow-sm"
      >
        {items.map((it) => (
          <option key={it.id} value={it.id}>{it.label}</option>
        ))}
      </select>
    </div>
  );
}

function ThemeToggle() {
  const { theme, toggle } = useTheme();
  const isDark = theme === "dark";
  return (
    <button
      type="button"
      data-testid="theme-toggle"
      onClick={toggle}
      aria-label={isDark ? "Cambiar a tema claro" : "Cambiar a tema oscuro"}
      title={isDark ? "Tema oscuro activo" : "Tema claro activo"}
      className="flex h-10 w-10 items-center justify-center rounded-xl border border-app-border bg-app-surface text-app-text shadow-sm transition hover:bg-app-elevated"
    >
      {isDark ? (
        /* sun */
        <svg viewBox="0 0 24 24" className="h-4.5 w-4.5" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
        </svg>
      ) : (
        /* moon */
        <svg viewBox="0 0 24 24" className="h-4.5 w-4.5" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
        </svg>
      )}
    </button>
  );
}

function TopBar({ me, onLogout }: { me: Me; onLogout: () => void }) {
  const { section, setSection } = useSection();
  return (
    <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b border-app-border bg-app-surface px-4 sm:px-6">
      <div>
        <div className="text-xs uppercase tracking-wide text-app-muted">
          {me.role === "admin" ? "Administración" : "Residente"}
        </div>
        <div className="text-base font-semibold text-app-text">
          {SECTION_TITLES[section] ?? "Panel"}
        </div>
      </div>
      <div className="flex items-center gap-3 sm:gap-4">
        <button
          type="button"
          onClick={() => setSection("perfil")}
          className="hidden text-right sm:block rounded-lg px-2 py-1 transition hover:bg-app-elevated"
          title="Ir a mi perfil"
        >
          <div className="text-sm font-medium text-app-text">{me.full_name}</div>
          <div className="text-[11px] capitalize text-app-muted">{me.role} · Perfil</div>
        </button>
        <button
          type="button"
          onClick={() => setSection("perfil")}
          className="flex h-10 w-10 items-center justify-center rounded-full bg-app-primary/15 text-app-primary transition hover:bg-app-primary/25 sm:hidden"
          title="Mi perfil"
        >
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor">
            <path d="M12 12a4 4 0 100-8 4 4 0 000 8zm0 2c-3.314 0-8 1.657-8 5v1h16v-1c0-3.343-4.686-5-8-5z" />
          </svg>
        </button>
        <ThemeToggle />
        <button
          data-testid="logout"
          type="button"
          onClick={onLogout}
          className="rounded-xl border border-app-border bg-app-surface px-3 py-2 text-sm font-medium text-app-text shadow-sm transition hover:bg-app-elevated"
        >
          Cerrar sesión
        </button>
      </div>
    </header>
  );
}

function Shell({
  me,
  onLogout,
  onMeUpdated,
}: {
  me: Me;
  onLogout: () => void;
  onMeUpdated: (next: Me) => void;
}) {
  const items = me.role === "admin" ? adminNav : residentNav;
  return (
    <SectionProvider initial="facturas">
      <div className="relative isolate flex h-screen overflow-hidden bg-app-bg text-app-text">
        <div className="animated-residential-bg" aria-hidden />
        <Sidebar items={items} />
        <div className="relative z-10 flex min-w-0 flex-1 flex-col lg:pl-64">
          <TopBar me={me} onLogout={onLogout} />
          <main className="flex-1 overflow-y-auto px-4 py-6 sm:px-6 sm:py-8">
            <div className="w-full space-y-6">
              <MobileSectionPicker items={items} />
              <ConnectionStatus />
              <Routes>
                <Route
                  path="/"
                  element={
                    me.role === "admin" ? (
                      <AdminDashboard me={me} onMeUpdated={onMeUpdated} />
                    ) : (
                      <ResidentDashboard me={me} onMeUpdated={onMeUpdated} />
                    )
                  }
                />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </div>
          </main>
        </div>
      </div>
    </SectionProvider>
  );
}

function AppInner() {
  const nav = useNavigate();
  const [token, setToken] = useState<string | null>(() => getToken());
  const [me, setMe] = useState<Me | null>(null);

  useEffect(() => {
    setAuthToken(token);
  }, [token]);

  useEffect(() => {
    if (!token) {
      setMe(null);
      return;
    }
    backend
      .get("/auth/me")
      .then((r) => setMe(r.data))
      .catch(() => {
        clearToken();
        setToken(null);
        nav("/login");
      });
  }, [token, nav]);

  const logout = useMemo(
    () => () => {
      clearToken();
      setToken(null);
      nav("/login");
    },
    [nav],
  );

  if (!token) {
    return (
      <Routes>
        <Route path="/login" element={<LoginPage onLogin={(t) => setToken(t)} />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  if (!me)
    return (
      <div className="flex min-h-screen items-center justify-center bg-app-bg p-8 text-app-muted">
        Cargando…
      </div>
    );
  return <Shell me={me} onLogout={logout} onMeUpdated={setMe} />;
}

export default function App() {
  return (
    <ThemeProvider>
      <AppInner />
    </ThemeProvider>
  );
}

/* ---------- Tiny inline icons (no extra deps) ---------- */
function IconProfile() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="8" r="3.5" />
      <path d="M5 20c0-3 3.13-5 7-5s7 2 7 5" />
    </svg>
  );
}
function IconUsers() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20c0-3.59 2.91-6.5 6.5-6.5s6.5 2.91 6.5 6.5" />
      <circle cx="17" cy="9" r="2.5" />
      <path d="M21.5 18.5c0-2.07-1.68-3.75-3.75-3.75" />
    </svg>
  );
}
function IconInvoice() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3z" />
      <path d="M9 8h6M9 12h6M9 16h4" />
    </svg>
  );
}
function IconBuilding() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="3" width="16" height="18" rx="1.5" />
      <path d="M9 7h2M13 7h2M9 11h2M13 11h2M9 15h2M13 15h2M10 21v-3h4v3" />
    </svg>
  );
}
function IconAmenity() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="9" width="18" height="11" rx="2" />
      <path d="M7 9V6a5 5 0 0110 0v3" />
    </svg>
  );
}
function IconCalendar() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4.5" width="18" height="16" rx="2" />
      <path d="M3 9h18M8 3v3M16 3v3" />
    </svg>
  );
}
function IconGym() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 12h2M20 12h2M6 7v10M18 7v10M6 12h12" />
    </svg>
  );
}
function IconCar() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 14l1.5-4.5A2 2 0 016.4 8h11.2a2 2 0 011.9 1.5L21 14v5h-3v-2H6v2H3v-5z" />
      <circle cx="7.5" cy="16.5" r="1.2" />
      <circle cx="16.5" cy="16.5" r="1.2" />
    </svg>
  );
}
function IconHall() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 11l9-7 9 7v10H3z" />
      <path d="M9 21v-6h6v6" />
    </svg>
  );
}
