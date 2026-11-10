import type { ReactNode } from "react";

interface PageHeaderProps {
  breadcrumb: string[];
  title: string;
  description?: string;
  actions?: ReactNode;
}

export function PageHeader({ breadcrumb, title, description, actions }: PageHeaderProps) {
  return (
    <header className="flex items-end justify-between gap-6">
      <div className="min-w-0">
        <nav aria-label="현재 위치" className="text-xs text-muted">
          {breadcrumb.map((item, index) => (
            <span key={`${index}-${item}`}>
              {index > 0 && <span className="mx-1.5">/</span>}
              {item}
            </span>
          ))}
        </nav>
        <h1 className="mt-2 text-[26px] leading-tight font-bold tracking-tight">{title}</h1>
        {description && <p className="mt-2 text-[13px] text-muted">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </header>
  );
}
