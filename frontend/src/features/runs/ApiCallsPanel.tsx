import clsx from "clsx";
import type { ApiCallsState } from "./runView";

const methodClass: Record<string, string> = {
  GET: "text-success",
  POST: "text-accent",
  PUT: "text-warning",
  PATCH: "text-warning",
  DELETE: "text-danger",
};


export function ApiCallsPanel({ calls, loading }: { calls: ApiCallsState; loading: boolean }) {
  return (
    <section aria-labelledby="api-calls-title" className="flex min-h-0 flex-col overflow-hidden rounded-card border border-line bg-surface">
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <h2 id="api-calls-title" className="text-[13px] font-bold">
          API 호출
        </h2>
        <span className="text-xs text-muted">
          {calls.totalCount}건{calls.averageDurationMs != null && ` · 평균 ${calls.averageDurationMs}ms`}
        </span>
      </div>
      {calls.items.length === 0 ? (
        <p className="px-4 py-8 text-center text-xs text-muted">{loading ? "불러오는 중" : "아직 API 호출이 없습니다"}</p>
      ) : (
        <ul className="max-h-[300px] overflow-y-auto">
          {calls.items.map((call) => (
            <li key={call.id} className="flex items-center gap-3 border-b border-line px-4 py-2.5 font-mono text-xs last:border-b-0">
              <span className={clsx("w-14 shrink-0 font-semibold", methodClass[call.method] ?? "text-muted")}>{call.method}</span>
              <span className="min-w-0 flex-1 truncate text-ink/85">{call.path}</span>
              <span className={clsx("w-8 text-right", call.statusCode != null && call.statusCode >= 400 ? "text-danger" : "text-success")}>
                {call.statusCode ?? "-"}
              </span>
              <span className="w-14 text-right text-muted">{call.durationMs != null ? `${call.durationMs}ms` : "-"}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

