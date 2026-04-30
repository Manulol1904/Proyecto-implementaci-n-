import { type PropsWithChildren } from "react";

export default function Card({ children }: PropsWithChildren) {
  return <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">{children}</div>;
}

