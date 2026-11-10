import { CircleCheck, CircleDashed } from "lucide-react";
import type { ReactNode } from "react";
import type { Activity, KnowledgeBase } from "@/api/types";
import { Badge } from "@/components/Badge";
import { EmptyBlock, ErrorBlock, LoadingBlock } from "@/components/StateViews";
import { formatClock, formatNumber } from "@/lib/format";
import { knowledgeBaseStatusView } from "./statusLabels";

interface QueryView<T> {
  data: T | undefined;
  isPending: boolean;
  isError: boolean;
  error: unknown;
  refetch: () => unknown;
}

function PanelTitle({ children, aside }: { children: string; aside?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <h2 className="text-[13px] font-bold">{children}</h2>
      {aside}
    </div>
  );
}

export function ReadinessPanel({ kb }: { kb: QueryView<KnowledgeBase> }) {
  return (
    <section>
      <PanelTitle>등록 요건</PanelTitle>
      {kb.isPending ? (
        <LoadingBlock className="py-4" />
      ) : kb.isError || !kb.data ? (
        <ErrorBlock className="py-4" error={kb.error} onRetry={() => void kb.refetch()} />
      ) : kb.data.readiness.length === 0 ? (
        <EmptyBlock className="py-4">확인할 요건이 없습니다.</EmptyBlock>
      ) : (
        <ul className="mt-3 flex flex-col gap-3">
          {kb.data.readiness.map((item) => (
            <li key={item.key} className="flex items-center gap-2.5 text-[13px]">
              {item.satisfied ? (
                <CircleCheck aria-label="충족" className="size-4 shrink-0 text-success" strokeWidth={1.75} />
              ) : (
                <CircleDashed aria-label="미충족" className="size-4 shrink-0 text-muted" strokeWidth={1.75} />
              )}
              <span className={item.satisfied ? "text-ink" : "text-ink/70"}>{item.label}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Count({ value, label }: { value: number; label: string }) {
  return (
    <div>
      <p className="font-mono text-2xl font-semibold">{value > 0 ? formatNumber(value) : "—"}</p>
      <p className="mt-1 text-xs text-muted">{label}</p>
    </div>
  );
}

export function KnowledgePreview({ kb }: { kb: QueryView<KnowledgeBase> }) {
  const status = kb.data ? knowledgeBaseStatusView[kb.data.status] : null;
  return (
    <section>
      <PanelTitle aside={status && <Badge tone={status.tone}>{status.label}</Badge>}>지식 베이스 미리보기</PanelTitle>
      {kb.isPending ? (
        <LoadingBlock className="py-4" />
      ) : kb.isError || !kb.data ? (
        <ErrorBlock className="py-4" error={kb.error} onRetry={() => void kb.refetch()} />
      ) : (
        <>
          <div className="mt-4 grid grid-cols-3 gap-4">
            <Count value={kb.data.requirementCount} label="요구사항" />
            <Count value={kb.data.apiCount} label="API" />
            <Count value={kb.data.uiElementCount} label="화면 요소" />
          </div>
          {kb.data.status === "FAILED" && kb.data.errorMessage && (
            <p className="mt-3 text-xs text-danger">{kb.data.errorMessage}</p>
          )}
          {kb.data.status === "STALE" && (
            <p className="mt-3 text-xs text-warning">문서가 바뀌었습니다. 지식 베이스를 다시 구축해야 새 테스트 요청을 받을 수 있습니다.</p>
          )}
        </>
      )}
    </section>
  );
}

export function ActivityList({ activities }: { activities: QueryView<Activity[]> }) {
  return (
    <section>
      <PanelTitle>최근 활동</PanelTitle>
      {activities.isPending ? (
        <LoadingBlock className="py-4" />
      ) : activities.isError || !activities.data ? (
        <ErrorBlock className="py-4" error={activities.error} onRetry={() => void activities.refetch()} />
      ) : activities.data.length === 0 ? (
        <EmptyBlock className="py-4">아직 활동이 없습니다.</EmptyBlock>
      ) : (
        <ol className="mt-3 flex flex-col gap-3">
          {activities.data.map((activity) => (
            <li key={activity.id} className="flex gap-3 text-[13px]">
              <time dateTime={activity.createdAt} className="w-10 shrink-0 font-mono text-xs leading-5 text-muted">
                {formatClock(activity.createdAt)}
              </time>
              <span className="min-w-0 text-ink/80">{activity.message}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
