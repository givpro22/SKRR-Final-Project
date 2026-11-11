import clsx from "clsx";
import { X } from "lucide-react";
import { useEffect, useId, useRef, type ReactNode } from "react";

type Width = "sm" | "md" | "lg" | "xl";

const widthClass: Record<Width, string> = {
  sm: "max-w-[440px]",
  md: "max-w-[600px]",
  lg: "max-w-[640px]",
  xl: "max-w-[760px]",
};

interface ModalProps {
  open: boolean;
  /** 접근성 이름. hideTitle이면 화면에는 보이지 않는다 */
  title: string;
  description?: ReactNode;
  onClose: () => void;
  children?: ReactNode;
  footer?: ReactNode;
  width?: Width;
  hideTitle?: boolean;
}

export function Modal({ open, title, description, onClose, children, footer, width = "sm", hideTitle }: ModalProps) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);

  // onClose는 부모가 그릴 때마다 새로 만들어질 수 있다. 그때마다 포커스를 옮기면
  // (예: 목록을 2초마다 다시 읽는 화면) 입력 중인 글자가 끊기므로 최신 값만 ref로 본다.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCloseRef.current();
    };
    document.addEventListener("keydown", onKey);
    // 열릴 때 한 번만 패널로 포커스를 옮긴다. 안쪽에 autoFocus 요소가 있으면 그쪽을 둔다
    if (!panelRef.current?.contains(document.activeElement)) panelRef.current?.focus();
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-overlay p-6" onMouseDown={onClose}>
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={clsx(
          "relative max-h-[calc(100vh-48px)] w-full overflow-y-auto rounded-card bg-surface p-7 shadow-xl outline-none",
          widthClass[width],
        )}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          aria-label="닫기"
          onClick={onClose}
          className="absolute top-6 right-6 flex size-8 items-center justify-center rounded-lg text-ink/70 hover:bg-page hover:text-ink"
        >
          <X aria-hidden className="size-5" />
        </button>
        <h2 id={titleId} className={clsx(hideTitle ? "sr-only" : "pr-10 text-xl font-bold")}>
          {title}
        </h2>
        {description && <div className="mt-2 pr-10 text-[13px] text-muted">{description}</div>}
        {children && <div className={clsx(!hideTitle && "mt-5")}>{children}</div>}
        {footer && <div className="mt-6 flex justify-end gap-2">{footer}</div>}
      </div>
    </div>
  );
}
