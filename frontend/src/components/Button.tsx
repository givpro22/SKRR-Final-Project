import clsx from "clsx";
import type { ButtonHTMLAttributes, ReactNode } from "react";

type Variant = "primary" | "secondary" | "danger" | "ghost";

const variantClass: Record<Variant, string> = {
  primary: "bg-ink text-surface hover:bg-ink/90 disabled:bg-ink/35",
  secondary: "border border-line-strong/60 bg-surface text-ink hover:bg-page disabled:text-muted",
  danger: "border border-danger bg-surface text-danger hover:bg-danger-soft disabled:opacity-50",
  ghost: "text-muted hover:bg-page hover:text-ink disabled:opacity-50",
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  icon?: ReactNode;
  size?: "md" | "sm";
  children?: ReactNode;
}

export function Button({ variant = "secondary", icon, size = "md", className, children, type, ...rest }: ButtonProps) {
  return (
    <button
      type={type ?? "button"}
      className={clsx(
        "inline-flex items-center justify-center gap-2 rounded-[10px] font-semibold transition-colors disabled:cursor-not-allowed",
        size === "md" ? "h-10 px-4 text-[13px]" : "h-8 px-3 text-xs",
        variantClass[variant],
        className,
      )}
      {...rest}
    >
      {icon}
      {children}
    </button>
  );
}
