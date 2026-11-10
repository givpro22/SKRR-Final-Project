import clsx from "clsx";
import { AlertCircle, Inbox } from "lucide-react";
import type { ReactNode } from "react";
import { errorMessage } from "@/api/errors";
import { Button } from "./Button";
import { Spinner } from "./Spinner";

export function LoadingBlock({ label = "불러오는 중", className }: { label?: string; className?: string }) {
  return (
    <div role="status" className={clsx("flex items-center justify-center gap-2 py-8 text-[13px] text-muted", className)}>
      <Spinner />
      {label}
    </div>
  );
}

export function ErrorBlock({ error, onRetry, className }: { error: unknown; onRetry?: () => void; className?: string }) {
  return (
    <div role="alert" className={clsx("flex flex-col items-center gap-3 py-8 text-center text-[13px]", className)}>
      <div className="flex items-center gap-2 text-danger">
        <AlertCircle aria-hidden className="size-4" />
        {errorMessage(error)}
      </div>
      {onRetry && (
        <Button size="sm" onClick={onRetry}>
          다시 시도
        </Button>
      )}
    </div>
  );
}

export function EmptyBlock({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={clsx("flex flex-col items-center gap-2 py-8 text-center text-[13px] text-muted", className)}>
      <Inbox aria-hidden className="size-5" />
      {children}
    </div>
  );
}
