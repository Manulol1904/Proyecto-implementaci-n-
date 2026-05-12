import { useState, type ReactNode } from "react";
import { backend } from "../lib/api";
import { setToken } from "../lib/auth";

export default function LoginPage({ onLogin }: { onLogin: (token: string) => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const body = new URLSearchParams();
      body.set("username", email);
      body.set("password", password);
      const r = await backend.post("/auth/login", body, {
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
      });
      setToken(r.data.access_token);
      onLogin(r.data.access_token);
    } catch (err: unknown) {
      const detail =
        err && typeof err === "object" && "response" in err
          ? (err as { response?: { data?: { detail?: string } } }).response?.data?.detail
          : undefined;
      setError(detail ?? "No se pudo iniciar sesión");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="relative isolate grid min-h-screen grid-cols-1 overflow-hidden bg-app-bg font-sans text-app-text lg:grid-cols-2">
      <div className="animated-residential-bg" aria-hidden />

      {/* Left brand panel */}
      <div className="relative z-10 hidden overflow-hidden bg-app-sidebar/95 lg:block">
        <div className="absolute -left-32 -top-32 h-96 w-96 rounded-full bg-app-primary/30 blur-3xl" />
        <div className="absolute -bottom-24 -right-24 h-96 w-96 rounded-full bg-app-accent/25 blur-3xl" />

        <div className="relative z-10 flex h-full flex-col justify-between p-12 text-white">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-app-primary text-white shadow-lg">
              <IconBuildings className="h-6 w-6" />
            </div>
            <div>
              <div className="text-base font-semibold">Residencial</div>
              <div className="text-xs text-app-sidebar-muted">Tu hogar, en orden</div>
            </div>
          </div>

          <div className="space-y-5">
            <span className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1 text-[11px] font-medium text-app-sidebar-muted">
              <IconKey className="h-3.5 w-3.5 text-app-primary" />
              Administración del conjunto
            </span>
            <h2 className="text-3xl font-bold leading-tight">
              Bienvenido a tu <span className="text-app-primary">comunidad</span>
            </h2>
            <p className="max-w-md text-sm leading-relaxed text-app-sidebar-muted">
              Administración al día, reservas del salón comunal, parqueaderos para
              visitantes y suscripciones del gimnasio — todo desde un solo lugar.
            </p>

            <div className="grid grid-cols-3 gap-3 pt-2">
              <Feature
                icon={<IconApartment className="h-5 w-5" />}
                title="Apartamentos"
                subtitle="Unidades del conjunto"
              />
              <Feature
                icon={<IconHallTree className="h-5 w-5" />}
                title="Áreas comunes"
                subtitle="Salón, gym y BBQ"
              />
              <Feature
                icon={<IconShield className="h-5 w-5" />}
                title="Seguridad"
                subtitle="Portería 24/7"
              />
            </div>

            <div className="flex flex-wrap gap-2 pt-2">
              <Chip icon={<IconGuard className="h-3.5 w-3.5" />}>Portería</Chip>
              <Chip icon={<IconVisitor className="h-3.5 w-3.5" />}>Visitantes</Chip>
              <Chip icon={<IconDumbbell className="h-3.5 w-3.5" />}>Gimnasio</Chip>
              <Chip icon={<IconHallSimple className="h-3.5 w-3.5" />}>Salón comunal</Chip>
              <Chip icon={<IconParking className="h-3.5 w-3.5" />}>Parqueaderos</Chip>
            </div>
          </div>

          <div aria-hidden />
        </div>
      </div>

      {/* Right form panel */}
      <div className="relative z-10 flex items-center justify-center px-6 py-10 sm:px-12">
        <div className="w-full max-w-md rounded-3xl border border-app-border bg-app-surface/90 p-8 shadow-card backdrop-blur-md">
          <div className="mb-8 flex items-start gap-3">
            <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl bg-app-primary/10 text-app-primary">
              <IconHouse className="h-6 w-6" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-app-text">Iniciar sesión</h1>
              <p className="mt-1 text-sm text-app-muted">
                Ingresa con las credenciales de tu unidad
              </p>
            </div>
          </div>

          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-app-text">Correo</label>
              <input
                data-testid="login-email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                className="w-full rounded-xl border border-app-border bg-app-surface px-4 py-3 text-sm text-app-text placeholder:text-app-muted shadow-sm outline-none transition focus:border-app-primary focus:ring-2 focus:ring-app-primary/25"
                placeholder="tu@email.com"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-app-text">Contraseña</label>
              <input
                data-testid="login-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                type="password"
                autoComplete="current-password"
                className="w-full rounded-xl border border-app-border bg-app-surface px-4 py-3 text-sm text-app-text placeholder:text-app-muted shadow-sm outline-none transition focus:border-app-primary focus:ring-2 focus:ring-app-primary/25"
                placeholder="••••••••"
              />
            </div>

            <div className="flex items-center justify-between text-xs">
              <label className="flex items-center gap-2 text-app-muted">
                <input
                  type="checkbox"
                  className="h-3.5 w-3.5 rounded border-app-border text-app-primary focus:ring-app-primary"
                />
                Recordarme
              </label>
              <button
                type="button"
                className="font-medium text-app-primary hover:underline"
                onClick={(e) => e.preventDefault()}
              >
                ¿Olvidaste tu contraseña?
              </button>
            </div>

            {error && (
              <div
                data-testid="login-error"
                className="rounded-xl border border-app-danger-border bg-app-danger-bg px-4 py-2.5 text-center text-xs font-medium text-app-danger-text"
              >
                {error}
              </div>
            )}

            <button
              data-testid="login-submit"
              type="submit"
              disabled={loading}
              className="mt-2 w-full rounded-xl bg-app-primary py-3 text-sm font-semibold text-white shadow-md transition hover:bg-app-primary-hover disabled:opacity-50"
            >
              {loading ? "Iniciando sesión…" : "Iniciar sesión"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

/* ---------- Small subcomponents ---------- */

function Feature({
  icon,
  title,
  subtitle,
}: {
  icon: ReactNode;
  title: string;
  subtitle: string;
}) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-3 backdrop-blur-sm">
      <div className="mb-1.5 text-app-primary">{icon}</div>
      <div className="text-xs font-semibold text-white">{title}</div>
      <div className="text-[10px] text-app-sidebar-muted">{subtitle}</div>
    </div>
  );
}

function Chip({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] font-medium text-app-sidebar-text">
      <span className="text-app-primary">{icon}</span>
      {children}
    </span>
  );
}

/* ---------- Inline icons (no extra deps) ---------- */

type IconProps = { className?: string };

function IconBuildings({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 21V8l6-3v16" />
      <path d="M9 21V11l6-2v12" />
      <path d="M15 21V13l6-1v9" />
      <path d="M3 21h18" />
    </svg>
  );
}

function IconApartment({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="3" width="16" height="18" rx="1.5" />
      <path d="M9 7h2M13 7h2M9 11h2M13 11h2M9 15h2M13 15h2M10 21v-3h4v3" />
    </svg>
  );
}

function IconHallTree({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 21V11l5-4 5 4v10" />
      <path d="M17 21v-7" />
      <circle cx="17" cy="10" r="3" />
      <path d="M3 21h18" />
    </svg>
  );
}

function IconShield({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3l8 3v6c0 4.5-3.4 8.4-8 9-4.6-.6-8-4.5-8-9V6l8-3z" />
      <path d="M9 12l2 2 4-4" />
    </svg>
  );
}

function IconKey({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="8" cy="14" r="3.5" />
      <path d="M10.5 11.5L21 3" />
      <path d="M17 7l3 3M14 10l2 2" />
    </svg>
  );
}

function IconHouse({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 11l9-7 9 7v10H3z" />
      <path d="M9 21v-6h6v6" />
    </svg>
  );
}

function IconGuard({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="8" r="3.5" />
      <path d="M5 21c0-3.5 3.1-6 7-6s7 2.5 7 6" />
      <path d="M9.5 5c.5-1.5 1.5-2.5 2.5-2.5s2 1 2.5 2.5" />
    </svg>
  );
}

function IconVisitor({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="10" cy="8" r="3.5" />
      <path d="M3 20c0-3.5 3.1-6 7-6s7 2.5 7 6" />
      <path d="M17 6v6M14 9h6" />
    </svg>
  );
}

function IconDumbbell({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 12h2M20 12h2M6 7v10M18 7v10M6 12h12" />
    </svg>
  );
}

function IconHallSimple({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 21V9l8-5 8 5v12" />
      <path d="M9 21v-6h6v6" />
    </svg>
  );
}

function IconParking({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="3" />
      <path d="M10 17V8h3.5a2.5 2.5 0 010 5H10" />
    </svg>
  );
}
