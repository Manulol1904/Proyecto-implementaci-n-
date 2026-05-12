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
        ? "border-app-success-border bg-app-success-bg text-app-success-text"
        : s === "fail"
          ? "border-app-danger-border bg-app-danger-bg text-app-danger-text"
          : "border-app-border bg-app-elevated text-app-muted";
    return (
      <span className={`rounded-full border px-2.5 py-1 text-[11px] font-medium ${cls}`}>
        {label}: {s}
      </span>
    );
  };

  return (
    <div className="flex flex-wrap items-center gap-3">
      {pill("backend", b)}
      {pill("payments", p)}
      <span className="text-[11px] text-app-muted">
        urls: {serviceUrls.backendUrl} · {serviceUrls.paymentsUrl}
      </span>
    </div>
  );
}
