import clsx from "clsx";
import { useEffect, useRef, useState, type ReactNode } from "react";

export interface MenuItem {
  key: string;
  label: string;
  icon?: ReactNode;
  danger?: boolean;
  onSelect: () => void;
}

interface MenuProps {
  /** 열기 버튼의 접근성 이름 */
  label: string;
  trigger: (props: { open: boolean; toggle: () => void }) => ReactNode;
  items: MenuItem[];
  align?: "left" | "right";
}

/** 더보기·템플릿 선택에 쓰는 작은 드롭다운 */
export function Menu({ label, trigger, items, align = "right" }: MenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: MouseEvent) => {
      const target = event.target;
      if (target instanceof Node && !rootRef.current?.contains(target)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      {trigger({ open, toggle: () => setOpen((v) => !v) })}
      {open && (
        <ul
          role="menu"
          aria-label={label}
          className={clsx(
            "absolute top-full z-20 mt-1 min-w-44 rounded-xl border border-line bg-surface p-1 shadow-lg",
            align === "right" ? "right-0" : "left-0",
          )}
        >
          {items.map((item) => (
            <li key={item.key} role="none">
              <button
                type="button"
                role="menuitem"
                className={clsx(
                  "flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[13px] hover:bg-page",
                  item.danger ? "text-danger" : "text-ink",
                )}
                onClick={() => {
                  setOpen(false);
                  item.onSelect();
                }}
              >
                {item.icon}
                {item.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
