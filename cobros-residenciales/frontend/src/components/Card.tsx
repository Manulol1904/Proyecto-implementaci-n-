import { type PropsWithChildren } from "react";

export default function Card({ children, className = "" }: PropsWithChildren<{ className?: string }>) {
  return (
    <div
      className={`rounded-2xl border border-app-border bg-app-surface p-5 shadow-card ${className}`}
    >
      {children}
    </div>
  );
}
