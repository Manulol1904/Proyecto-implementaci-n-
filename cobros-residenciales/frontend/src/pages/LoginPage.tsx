import { useMemo, useState } from "react";
import { backend } from "../lib/api";
import { setToken } from "../lib/auth";

const LOGIN_CYAN = "#00f2ff";
const TICK_MUTED = "#2f3d52";

/** Radial dash ring (muted ticks + cyan arc ~9–11 o’clock). */
function LoginRadialRing({ className }: { className?: string }) {
  const ticks = 72;
  const cx = 200;
  const cy = 200;
  const inner = 148;
  const outer = 172;

  const lines = useMemo(() => {
    const highlightStart = Math.floor((270 / 360) * ticks);
    const highlightEnd = Math.ceil((330 / 360) * ticks);
    return Array.from({ length: ticks }, (_, i) => {
      const angleDeg = (i / ticks) * 360 - 90;
      const rad = (angleDeg * Math.PI) / 180;
      const highlighted = i >= highlightStart && i <= highlightEnd;
      return {
        x1: cx + inner * Math.cos(rad),
        y1: cy + inner * Math.sin(rad),
        x2: cx + outer * Math.cos(rad),
        y2: cy + outer * Math.sin(rad),
        highlighted,
      };
    });
  }, []);

  return (
    <svg
      className={className}
      viewBox="0 0 400 400"
      aria-hidden
    >
      <defs>
        <filter id="login-tick-glow" x="-40%" y="-40%" width="180%" height="180%">
          <feGaussianBlur stdDeviation="1.2" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      {lines.map((line, i) => (
        <line
          key={i}
          x1={line.x1}
          y1={line.y1}
          x2={line.x2}
          y2={line.y2}
          stroke={line.highlighted ? LOGIN_CYAN : TICK_MUTED}
          strokeWidth={line.highlighted ? 5 : 4}
          strokeLinecap="round"
          filter={line.highlighted ? "url(#login-tick-glow)" : undefined}
        />
      ))}
    </svg>
  );
}

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
    <div className="flex min-h-screen items-center justify-center bg-app-bg px-4 py-10 font-sans text-white antialiased">
      <div className="relative flex w-full max-w-[380px] flex-col items-center">
        <div className="relative flex aspect-square w-full max-w-[360px] items-center justify-center">
          <LoginRadialRing className="pointer-events-none absolute inset-0 h-full w-full" />
          <div className="relative z-10 flex w-[min(100%,260px)] flex-col items-center px-2">
            <h1 className="mb-8 text-2xl font-bold tracking-tight text-app-cyan">Login</h1>

            <form onSubmit={submit} className="flex w-full flex-col items-center gap-5">
              <input
                data-testid="login-email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                className="w-full rounded-[50px] border px-5 py-3.5 text-sm text-white outline-none placeholder:text-white/90 focus-visible:ring-2 focus-visible:ring-[#00f2ff]/40"
                style={{
                  backgroundColor: "#0a1019",
                  borderColor: "#243044",
                }}
                placeholder="Email"
              />

              <input
                data-testid="login-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                type="password"
                autoComplete="current-password"
                className="w-full rounded-[50px] border px-5 py-3.5 text-sm text-white outline-none placeholder:text-white/90 focus-visible:ring-2 focus-visible:ring-[#00f2ff]/40"
                style={{
                  backgroundColor: "#0a1019",
                  borderColor: "#243044",
                }}
                placeholder="Password"
              />

              <button
                type="button"
                className="mt-1 text-center text-xs text-white/90 underline-offset-2 hover:underline"
                onClick={(e) => e.preventDefault()}
              >
                Forgot your password?
              </button>

              {error && (
                <div
                  data-testid="login-error"
                  className="w-full rounded-[50px] border px-4 py-2 text-center text-xs text-rose-200"
                  style={{
                    borderColor: "#7f1d1d",
                    backgroundColor: "rgba(69, 10, 10, 0.35)",
                  }}
                >
                  {error}
                </div>
              )}

              <button
                data-testid="login-submit"
                type="submit"
                disabled={loading}
                className="mt-2 w-full rounded-[50px] py-3.5 text-base font-semibold transition-opacity disabled:opacity-50"
                style={{
                  backgroundColor: LOGIN_CYAN,
                  color: "#0a1628",
                }}
              >
                {loading ? "Signing in…" : "Login"}
              </button>
            </form>

            <button
              type="button"
              className="mt-8 text-sm font-medium hover:opacity-90"
              style={{ color: LOGIN_CYAN }}
              onClick={(e) => e.preventDefault()}
            >
              Signup
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
