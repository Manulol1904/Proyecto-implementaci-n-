import { type ButtonHTMLAttributes } from "react";

export default function Button(props: ButtonHTMLAttributes<HTMLButtonElement>) {
  const { className = "", type = "button", ...rest } = props;
  return (
    <button
      type={type}
      className={`rounded-xl bg-app-primary px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-app-primary-hover disabled:opacity-50 ${className}`}
      {...rest}
    />
  );
}
