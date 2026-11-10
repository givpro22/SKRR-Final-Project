import clsx from "clsx";
import type { ReactNode } from "react";

export type Tone = "success" | "accent" | "danger" | "warning" | "muted";

// 클래스 이름을 조합하지 않고 완성된 문자열로 둔다. Tailwind가 소스에서 찾을 수 있어야 한다.
const toneClass: Record<Tone, string> = {
  success: "bg-success-soft text-success",
  accent: "bg-accent-soft text-accent",
  danger: "bg-danger-soft text-danger",
  warning: "bg-warning-soft text-warning",
  muted: "bg-field text-muted",
};

interface BadgeProps {
  tone: Tone;
  icon?: ReactNode;
  children: ReactNode;
  className?: string;
}

export function Badge({ tone, icon, children, className }: BadgeProps) {
  return (
    <span
      className={clsx(
        "inline-flex h-6 shrink-0 items-center gap-1 rounded-full px-2.5 text-xs font-medium whitespace-nowrap",
        toneClass[tone],
        className,
      )}
    >
      {icon}
      {children}
    </span>
  );
}
