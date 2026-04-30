import { useEffect, useState } from "react";
import { backend, payments, serviceUrls } from "../lib/api";

type Status = "checking" | "ok" | "fail";

export default function ConnectionStatus() {
  const [b, setB] = useState<Status>("checking");
  const [p, setP] = useState<Status>("checking");

  useEffect(() => {
    let cancelled = false;

    backend
      .get("/health")
      .then(() => !cancelled && setB("ok"))
      .catch(() => !cancelled && setB("fail"));

    payments
      .get("/health")
      .then(() => !cancelled && setP("ok"))
      .catch(() => !cancelled && setP("fail"));

    return () => {
      cancelled = true;
    };
  }, []);

  const pill = (label: string, s: Status) => {
    const cls =
      s === "ok"
        ? "border-emerald-900 bg-emerald-950/40 text-emerald-200"
        : s === "fail"
          ? "border-rose-900 bg-rose-950/40 text-rose-200"
          : "border-slate-800 bg-slate-900/60 text-slate-300";
    return <span className={`rounded-full border px-2 py-0.5 text-[11px] ${cls}`}>{label}: {s}</span>;
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      {pill("backend", b)}
      {pill("payments", p)}
      <span className="text-[11px] text-slate-400">
        urls: {serviceUrls.backendUrl} · {serviceUrls.paymentsUrl}
      </span>
    </div>
  );
}

