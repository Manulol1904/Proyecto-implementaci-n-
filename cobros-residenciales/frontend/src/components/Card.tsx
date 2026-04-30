import { type PropsWithChildren } from "react";

export default function Card({ children, className = "" }: PropsWithChildren<{ className?: string }>) {
  return (
    <div
      className={`rounded-2xl border border-app-border bg-app-surface/90 p-5 shadow-lg shadow-black/20 backdrop-blur-sm ${className}`}
    >
      {children}
    </div>
  );
}
