import { useEffect, useMemo, useState } from "react";
import { Link, Navigate, Route, Routes, useNavigate } from "react-router-dom";
import { backend } from "./lib/api";
import { clearToken, getToken, type Me } from "./lib/auth";
import { setAuthToken } from "./lib/api";
import LoginPage from "./pages/LoginPage";
import AdminDashboard from "./pages/admin/AdminDashboard";
import ResidentDashboard from "./pages/resident/ResidentDashboard";
import ConnectionStatus from "./components/ConnectionStatus";

function Shell({ me, onLogout }: { me: Me; onLogout: () => void }) {
  return (
    <div className="min-h-screen bg-app-bg">
      <header className="border-b border-app-border bg-app-surface/40 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-6">
            <Link to="/" className="text-base font-semibold tracking-tight text-app-cyan">
              Cobros Residenciales
            </Link>
            <span className="text-sm text-app-muted">
              {me.full_name}
              <span className="mx-2 text-app-border">·</span>
              <span className="capitalize text-white/90">{me.role}</span>
            </span>
          </div>
          <button
            type="button"
            onClick={onLogout}
            className="self-start rounded-xl border border-app-border bg-app-elevated px-4 py-2 text-sm text-white/90 hover:bg-white/10 sm:self-auto"
          >
            Cerrar sesión
          </button>
        </div>
        <div className="mx-auto max-w-6xl border-t border-app-border/60 px-4 pb-4 pt-3">
          <ConnectionStatus />
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-10">
        <Routes>
          <Route path="/" element={me.role === "admin" ? <AdminDashboard /> : <ResidentDashboard />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
}

export default function App() {
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
  return <Shell me={me} onLogout={logout} />;
}

