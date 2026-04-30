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
    <div className="min-h-screen">
      <header className="border-b border-slate-800 bg-slate-950/60 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-4">
            <Link to="/" className="text-sm font-semibold">
              Cobros Residenciales
            </Link>
            <span className="text-xs text-slate-400">
              {me.full_name} · {me.role}
            </span>
          </div>
          <button onClick={onLogout} className="text-xs text-slate-300 hover:text-white">
            Cerrar sesión
          </button>
        </div>
        <div className="mx-auto max-w-6xl px-4 pb-3">
          <ConnectionStatus />
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">
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

  if (!me) return <div className="p-6 text-sm text-slate-300">Cargando…</div>;
  return <Shell me={me} onLogout={logout} />;
}

