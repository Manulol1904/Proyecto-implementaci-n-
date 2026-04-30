import { type ButtonHTMLAttributes } from "react";

export default function Button(props: ButtonHTMLAttributes<HTMLButtonElement>) {
  const { className = "", type = "button", ...rest } = props;
  return (
    <button
      type={type}
      className={`rounded-xl bg-app-cyan px-4 py-2.5 text-sm font-semibold text-[#0a1628] transition hover:brightness-110 disabled:opacity-50 ${className}`}
      {...rest}
    />
  );
}
