import { useState } from "react";
import { backend } from "../lib/api";
import { setToken } from "../lib/auth";
import Button from "../components/Button";
import Card from "../components/Card";

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
    } catch (err: any) {
      setError(err?.response?.data?.detail ?? "No se pudo iniciar sesión");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-md items-center px-4">
      <Card>
        <h1 className="text-lg font-semibold">Ingresar</h1>
        <p className="mt-1 text-xs text-slate-400">Usa tu email y contraseña.</p>

        <form onSubmit={submit} className="mt-4 space-y-3">
          <div>
            <label className="text-xs text-slate-300">Email</label>
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm"
              placeholder="admin@conjunto.com"
            />
          </div>
          <div>
            <label className="text-xs text-slate-300">Contraseña</label>
            <input
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              type="password"
              className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm"
              placeholder="********"
            />
          </div>

          {error && <div className="rounded-lg border border-rose-900 bg-rose-950/40 p-2 text-xs text-rose-200">{error}</div>}

          <Button type="submit" disabled={loading} className="w-full">
            {loading ? "Ingresando…" : "Entrar"}
          </Button>
        </form>
      </Card>
    </div>
  );
}

