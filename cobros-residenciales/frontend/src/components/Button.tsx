import { type ButtonHTMLAttributes } from "react";

export type ButtonVariant = "primary" | "secondary" | "danger";

const base =
  "inline-flex items-center justify-center rounded-xl px-4 py-2.5 text-sm font-semibold transition disabled:pointer-events-none disabled:opacity-50";

const variants: Record<ButtonVariant, string> = {
  primary: "bg-app-primary text-white shadow-sm hover:bg-app-primary-hover",
  secondary:
    "border border-app-border bg-app-surface text-app-text shadow-sm hover:bg-app-elevated hover:border-slate-300/90 dark:hover:border-app-border",
  danger: "bg-rose-600 text-white shadow-sm hover:bg-rose-700",
};

export default function Button({
  variant = "primary",
  className = "",
  type = "button",
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }) {
  return (
    <button type={type} className={`${base} ${variants[variant]} ${className}`} {...rest} />
  );
}
