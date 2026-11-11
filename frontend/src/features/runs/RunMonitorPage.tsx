import { Code2, FileChartColumn, Radio, Square } from "lucide-react";
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { errorMessage } from "@/api/errors";
import { queryKeys } from "@/api/queries/keys";
import { fetchRunApiCalls, fetchRunLogs, isRunFinished, useCancelRun, useRunSnapshot } from "@/api/queries/runs";
import type { CaseRunSummary, RunDetail } from "@/api/types";
import { useProjectContext } from "@/app/useProjectContext";
import { Badge } from "@/components/Badge";
import { Button } from "@/components/Button";
import { Modal } from "@/components/Modal";
import { PageHeader } from "@/components/PageHeader";
import { ErrorBlock, LoadingBlock } from "@/components/StateViews";
import { ApiCallsPanel } from "./ApiCallsPanel";
import { CurrentScreen } from "./CurrentScreen";
import { formatElapsed, PROGRESS_SEGMENTS, runStatusBadge, runTitle } from "./labels";
import { LogPanel, type LogTab } from "./LogPanel";
import { applyRunEvent, type RunEvent } from "./runEvents";
import { ScenarioCards } from "./ScenarioCards";
import { addApiCall, MAX_LOG_LINES, progressOf, specCaseOf, stripAnsi, type ApiCallsState, type LogLine } from "./runView";
import { useRunEvents } from "./useRunEvents";

const REPORT_REDIRECT_MS = import.meta.env.MODE === "test" ? 1500 : 3000;

/** UI-03 실행 모니터. 테스트는 EventSourceFactoryContext로 가짜 EventSource를 넣는다 */
export function RunMonitorPage() {
  const { runId = "" } = useParams();
  const { project } = useProjectContext();
  const navigate = useNavigate();
  const snapshot = useRunSnapshot(runId);
  // 실행이 이 화면에서 끝나면 잠시 뒤 결과 리포트로 이동한다 (events.md run.status "종료 시 리포트 이동")
  const [leaving, setLeaving] = useState<"pending" | "stay" | null>(null);
  const reportPath = `/projects/${project.id}/runs/${runId}/report`;
  useEffect(() => {
    if (leaving !== "pending") return;
    const timer = setTimeout(() => navigate(reportPath), REPORT_REDIRECT_MS);
    return () => clearTimeout(timer);
  }, [leaving, navigate, reportPath]);

  if (snapshot.isPending) return <LoadingBlock className="mt-24" label="실행 정보를 불러오는 중" />;
  if (snapshot.isError) return <ErrorBlock className="mt-24" error={snapshot.error} onRetry={() => void snapshot.refetch()} />;
  // 스냅샷을 다시 읽으면(다시 연결) 화면 상태와 SSE 연결을 새로 만든다
  return (
    <>
      {leaving === "pending" && (
        <div role="status" className="mb-5 flex items-center gap-3 rounded-xl bg-accent-soft px-4 py-3 text-[13px] text-accent">
          <span className="flex-1">실행이 끝났어요. 잠시 뒤 결과 리포트로 이동합니다.</span>
          <Button size="sm" variant="primary" onClick={() => navigate(reportPath)}>
            지금 보기
          </Button>
          <Button size="sm" onClick={() => setLeaving("stay")}>
            여기 머물기
          </Button>
        </div>
      )}
      <Monitor
        key={snapshot.dataUpdatedAt}
        snapshot={snapshot.data}
        reportPath={reportPath}
        onReconnect={() => void snapshot.refetch()}
        onFinishedLive={() => setLeaving((prev) => prev ?? "pending")}
      />
    </>
  );
}

function mergeLines(prev: LogLine[], next: LogLine[]): LogLine[] {
  const keys = new Set(prev.map((l) => l.key));
  const merged = [...prev, ...next.filter((l) => !keys.has(l.key))];
  merged.sort((a, b) => (a.seq ?? Number.MAX_SAFE_INTEGER) - (b.seq ?? Number.MAX_SAFE_INTEGER));
  return merged.slice(-MAX_LOG_LINES);
}

function eventToLine(event: RunEvent, seq: number | null): LogLine | null {
  const key = seq !== null ? `e-${seq}` : `e-${Date.now()}-${Math.random()}`;
  if (event.type === "log") return { key, seq, occurredAt: event.occurredAt, kind: event.kind, text: stripAnsi(event.message) };
  // verification은 백엔드가 같은 내용의 log(ASSERT)를 함께 보내므로 따로 줄을 만들지 않는다 (backend M3-3)
  return null;
}

function useNow(active: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [active]);
  return now;
}

function Monitor({
  snapshot,
  reportPath,
  onReconnect,
  onFinishedLive,
}: {
  snapshot: RunDetail;
  reportPath: string;
  onReconnect: () => void;
  onFinishedLive: () => void;
}) {
  const { project } = useProjectContext();
  const queryClient = useQueryClient();
  const [run, dispatch] = useReducer(applyRunEvent, snapshot);
  const [lines, setLines] = useState<LogLine[]>([]);
  const [calls, setCalls] = useState<ApiCallsState>({ items: [], totalCount: 0, averageDurationMs: null });
  const [callsLoading, setCallsLoading] = useState(true);
  const [screen, setScreen] = useState({ artifactId: snapshot.latestScreenshotArtifactId ?? null, path: snapshot.currentPath ?? null });
  const [tab, setTab] = useState<LogTab>("log");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const cancel = useCancelRun(run.id);
  const logRef = useRef<HTMLDivElement>(null);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
    },
    [],
  );

  // 저장된 로그와 API 호출을 먼저 읽는다. SSE로 오는 것과 겹치면 seq·id로 한 번만 남긴다
  useEffect(() => {
    let alive = true;
    fetchRunLogs(run.id)
      .then((items) => {
        if (!alive) return;
        setLines((prev) =>
          mergeLines(
            prev,
            items.map((item) => ({ key: `e-${item.seq}`, seq: item.seq, occurredAt: item.occurredAt, kind: item.kind, text: stripAnsi(item.message) })),
          ),
        );
      })
      .catch((error: unknown) => alive && setLoadError(`저장된 로그를 불러오지 못했습니다: ${errorMessage(error)}`));
    fetchRunApiCalls(run.id)
      .then((result) => {
        if (!alive) return;
        setCalls((prev) => {
          let next: ApiCallsState = {
            items: result.items,
            totalCount: result.totalCount,
            averageDurationMs: result.averageDurationMs ?? null,
          };
          // 먼저 도착한 SSE 호출 중 목록에 없는 것만 더한다
          for (const call of [...prev.items].reverse()) next = addApiCall(next, call);
          return next;
        });
      })
      .catch((error: unknown) => alive && setLoadError(`API 호출 목록을 불러오지 못했습니다: ${errorMessage(error)}`))
      .finally(() => alive && setCallsLoading(false));
    return () => {
      alive = false;
    };
  }, [run.id]);

  const onEvent = useCallback(
    (event: RunEvent, seq: number | null) => {
      dispatch(event);
      if (event.type === "api.call") {
        const { type: _t, ...call } = event;
        void _t;
        setCalls((prev) => addApiCall(prev, call));
      } else if (event.type === "screenshot") {
        setScreen({ artifactId: event.artifactId, path: event.path });
      } else {
        const line = eventToLine(event, seq);
        if (line) setLines((prev) => mergeLines(prev, [line]));
      }
      if (event.type === "run.status" && isRunFinished(event.status)) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.runs(project.id) });
        // 끝난 뒤 스냅샷을 한 번 더 읽어 시간·최종 단계처럼 이벤트에 없던 값을 채운다
        refreshTimer.current = setTimeout(onReconnect, 800);
        onFinishedLive();
      }
    },
    [queryClient, project.id, onReconnect, onFinishedLive],
  );

  const finished = isRunFinished(run.status);
  const connection = useRunEvents({
    runId: run.id,
    afterSeq: snapshot.lastEventSeq,
    enabled: !isRunFinished(snapshot.status),
    onEvent,
  });

  const now = useNow(!finished);
  const specCase: CaseRunSummary | null = specCaseOf(run);
  const finishedCases = run.scenarioRuns
    .flatMap((s) => s.cases)
    .filter((c) => c.status === "PASSED" || c.status === "FAILED" || c.status === "ERROR");
  const progress = progressOf(run);
  const badge = runStatusBadge[run.status];
  const canCancel = run.status === "PREPARING" || run.status === "RUNNING";

  const elapsedEnd = finished && run.finishedAt ? new Date(run.finishedAt).getTime() : now;

  return (
    <>
      <PageHeader
        breadcrumb={[project.name, "실행 모니터", run.code]}
        title={runTitle[run.status]}
        titleAside={
          <Badge tone={badge.tone} icon={!finished ? <Radio aria-hidden className="size-3" /> : undefined} className="font-mono">
            {badge.label}
            {run.startedAt && ` · ${formatElapsed(run.startedAt, elapsedEnd)}`}
          </Badge>
        }
        actions={
          <>
            <Button
              icon={<Code2 aria-hidden className="size-4" />}
              onClick={() => {
                setTab("spec");
                logRef.current?.scrollIntoView?.({ behavior: "smooth", block: "nearest" });
              }}
            >
              spec 코드 보기
            </Button>
            {finished && (
              <Link
                to={reportPath}
                className="inline-flex h-10 items-center gap-2 rounded-[10px] bg-ink px-4 text-[13px] font-semibold text-surface hover:bg-ink/90"
              >
                <FileChartColumn aria-hidden className="size-4" />
                결과 리포트 보기
              </Link>
            )}
            {!finished && (
              <Button
                variant="danger"
                icon={<Square aria-hidden className="size-3.5" />}
                disabled={!canCancel || cancel.isPending}
                onClick={() => setConfirmCancel(true)}
              >
                {run.status === "CANCELLING" ? "멈추는 중" : "실행 중단"}
              </Button>
            )}
          </>
        }
      />

      {(run.errorMessage || loadError || cancel.error) && (
        <div role="alert" className="mt-5 rounded-xl border border-danger-soft bg-surface px-4 py-3 text-xs text-danger">
          {run.errorMessage ?? loadError ?? errorMessage(cancel.error)}
        </div>
      )}

      <div className="mt-7 grid grid-cols-[320px_minmax(0,1fr)] gap-5">
        <div className="flex flex-col gap-4">
          <section aria-label="진행 현황">
            <div className="flex items-baseline justify-between">
              <p className="font-mono text-[28px] font-semibold tracking-tight">
                {progress.finishedScenarios} <span className="mx-1 text-muted">/</span> {progress.totalScenarios}
              </p>
              <span className="text-xs text-muted">시나리오 완료</span>
            </div>
            <div aria-hidden className="mt-3 flex h-1.5 gap-0.5 overflow-hidden rounded-full">
              {PROGRESS_SEGMENTS.map((seg) =>
                progress[seg.key] > 0 ? (
                  <span key={seg.key} className={seg.bar} style={{ flexGrow: progress[seg.key], flexBasis: 0 }} />
                ) : null,
              )}
            </div>
            <ul aria-label="진행 범례" className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-xs text-ink/70">
              {PROGRESS_SEGMENTS.filter((seg) => seg.always || progress[seg.key] > 0).map((seg) => (
                <li key={seg.key} className="flex items-center gap-1.5">
                  <span aria-hidden className={`size-2 rounded-sm ${seg.bar}`} />
                  {seg.label} {progress[seg.key]}
                </li>
              ))}
            </ul>
          </section>
          <ScenarioCards scenarioRuns={run.scenarioRuns} />
        </div>

        <div className="flex min-w-0 flex-col gap-5">
          <CurrentScreen artifactId={screen.artifactId} path={screen.path} />
          <div ref={logRef} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)] gap-5">
            <ApiCallsPanel calls={calls} loading={callsLoading} />
            <LogPanel
              lines={lines}
              connection={connection}
              tab={tab}
              onTab={setTab}
              specCase={specCase}
              finishedCases={finishedCases}
              onReconnect={onReconnect}
            />
          </div>
        </div>
      </div>

      <Modal
        open={confirmCancel}
        title="실행을 멈출까요?"
        description="진행 중인 케이스를 정리한 뒤 멈춥니다. 시작하지 않은 시나리오는 중단됨으로 남습니다."
        onClose={() => setConfirmCancel(false)}
        footer={
          <>
            <Button onClick={() => setConfirmCancel(false)}>계속 실행</Button>
            <Button
              variant="danger"
              disabled={cancel.isPending}
              onClick={() =>
                cancel.mutate(undefined, {
                  onSuccess: (result) => {
                    setConfirmCancel(false);
                    // 서버가 CANCELLING으로 바꿨다. 끝 상태는 SSE run.status로 온다
                    dispatch({ type: "run.status", status: result.status, progress: null, errorMessage: null });
                  },
                  onError: () => setConfirmCancel(false),
                })
              }
            >
              {cancel.isPending ? "요청 중" : "실행 중단"}
            </Button>
          </>
        }
      />
    </>
  );
}
