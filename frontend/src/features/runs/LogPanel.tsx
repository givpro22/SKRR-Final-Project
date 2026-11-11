import clsx from "clsx";
import { useEffect, useRef, useState } from "react";
import { ApiError, errorMessage } from "@/api/errors";
import { fetchArtifactLink, fetchCaseResult, useCaseSpec } from "@/api/queries/runs";
import type { CaseRunSummary } from "@/api/types";
import { openLink } from "@/lib/download";
import { logKindClass } from "./labels";
import type { ConnectionState } from "./useRunEvents";
import { MAX_LOG_LINES, specFileName, type LogLine } from "./runView";



export type LogTab = "log" | "spec" | "trace";

const timeFormatter = new Intl.DateTimeFormat("ko-KR", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });

const connectionView: Record<ConnectionState, { label: string; dot: string }> = {
  connecting: { label: "connecting", dot: "bg-log-muted" },
  open: { label: "streaming", dot: "bg-log-assert" },
  reconnecting: { label: "재연결 중", dot: "bg-log-api animate-pulse" },
  closed: { label: "연결 끊김", dot: "bg-danger" },
  ended: { label: "종료", dot: "bg-log-muted" },
};

interface Props {
  lines: LogLine[];
  connection: ConnectionState;
  tab: LogTab;
  onTab: (tab: LogTab) => void;
  /** spec 탭에 보일 케이스 (실행 중인 케이스, U4) */
  specCase: CaseRunSummary | null;
  finishedCases: CaseRunSummary[];
  onReconnect: () => void;
}


export function LogPanel({ lines, connection, tab, onTab, specCase, finishedCases, onReconnect }: Props) {
  const view = connectionView[connection];
  const tabs: { key: LogTab; label: string }[] = [
    { key: "log", label: "실시간 로그" },
    { key: "spec", label: specCase ? specFileName(specCase.code) : "spec" },
    { key: "trace", label: "Trace" },
  ];
  return (
    <section aria-label="실시간 로그" className="flex min-h-[320px] flex-col overflow-hidden rounded-card bg-log text-log-text">
      <div className="flex items-center gap-1 border-b border-log-line px-4">
        <div role="tablist" className="flex gap-4">
          {tabs.map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={tab === t.key}
              onClick={() => onTab(t.key)}
              className={clsx(
                "border-b-2 py-3 text-xs",
                t.key !== "log" && "font-mono",
                tab === t.key ? "border-white font-semibold text-white" : "border-transparent text-log-muted hover:text-log-text",
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
        <span className="ml-auto flex items-center gap-1.5 font-mono text-[11px] text-log-muted" aria-live="polite">
          <span aria-hidden className={clsx("size-1.5 rounded-full", view.dot)} />
          {view.label}
          {connection === "closed" && (
            <button type="button" onClick={onReconnect} className="ml-2 rounded border border-log-line px-2 py-0.5 text-log-text hover:bg-log-line">
              다시 연결
            </button>
          )}
        </span>
      </div>
      <div className="min-h-0 flex-1">
        {tab === "log" && <LogLines lines={lines} streaming={connection === "open"} />}
        {tab === "spec" && <SpecView specCase={specCase} />}
        {tab === "trace" && <TraceView cases={finishedCases} />}
      </div>
    </section>
  );
}

function LogLines({ lines, streaming }: { lines: LogLine[]; streaming: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  useEffect(() => {
    const el = ref.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [lines]);
  const shown = lines.slice(-MAX_LOG_LINES);
  return (
    <div
      ref={ref}
      data-testid="log-lines"
      onScroll={(event) => {
        const el = event.currentTarget;
        // 맨 아래 근처에 있을 때만 새 줄을 따라 내려간다
        stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
      }}
      className="h-full max-h-[340px] overflow-y-auto px-4 py-3 font-mono text-xs leading-6"
    >
      {shown.length === 0 && <p className="text-log-muted">아직 로그가 없습니다</p>}
      {shown.map((line) => (
        <div key={line.key} className="grid grid-cols-[64px_64px_1fr] gap-2">
          <time dateTime={line.occurredAt} className="text-log-muted">
            {timeFormatter.format(new Date(line.occurredAt))}
          </time>
          <span className={clsx("font-semibold", logKindClass[line.kind])}>{line.kind}</span>
          <span className={clsx("break-words", line.danger ? "text-log-danger" : "text-log-text")}>{line.text}</span>
        </div>
      ))}
      {streaming && <span aria-hidden className="mt-1 inline-block h-3.5 w-2 animate-pulse bg-log-text" />}
    </div>
  );
}

function SpecView({ specCase }: { specCase: CaseRunSummary | null }) {
  const spec = useCaseSpec(specCase?.id ?? null);
  if (!specCase) return <p className="px-4 py-3 font-mono text-xs text-log-muted">실행 중인 케이스가 없습니다</p>;
  if (spec.isPending) return <p className="px-4 py-3 font-mono text-xs text-log-muted">spec을 불러오는 중</p>;
  if (spec.isError) {
    const notReady = spec.error instanceof ApiError && spec.error.status === 404;
    return (
      <p className="px-4 py-3 font-mono text-xs text-log-muted">
        {notReady ? `${specFileName(specCase.code)}을 아직 만들고 있습니다 (준비 중)` : errorMessage(spec.error)}
      </p>
    );
  }
  return (
    <div className="h-full max-h-[340px] overflow-auto px-4 py-3">
      {spec.data.compileStatus === "FAILED" && (
        <p className="mb-2 font-mono text-xs text-log-danger">컴파일 실패: {spec.data.compileError}</p>
      )}
      <pre aria-label={spec.data.fileName} className="font-mono text-xs leading-5 whitespace-pre text-log-text">
        {spec.data.source}
      </pre>
    </div>
  );
}

function TraceView({ cases }: { cases: CaseRunSummary[] }) {
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  if (cases.length === 0) {
    return <p className="px-4 py-3 font-mono text-xs text-log-muted">Trace는 실행이 끝난 케이스에서 받을 수 있습니다</p>;
  }
  const download = async (c: CaseRunSummary) => {
    setBusy(c.id);
    setMessage(null);
    try {
      const detail = await fetchCaseResult(c.id);
      const trace = detail.artifacts.find((a) => a.type === "TRACE");
      if (!trace) {
        setMessage(`${c.code}의 Trace가 아직 없습니다`);
        return;
      }
      const link = await fetchArtifactLink(trace.id);
      openLink(link.url, `${c.code.toLowerCase()}-trace.zip`);
    } catch (error) {
      setMessage(`${c.code} Trace를 받지 못했습니다: ${errorMessage(error)}`);
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="max-h-[340px] overflow-y-auto px-4 py-3 font-mono text-xs">
      <ul className="flex flex-col gap-1.5">
        {cases.map((c) => (
          <li key={c.id} className="flex items-center gap-3">
            <span className="w-14 text-log-muted">{c.code}</span>
            <span className="min-w-0 flex-1 truncate">{c.title}</span>
            <button
              type="button"
              disabled={busy === c.id}
              onClick={() => void download(c)}
              className="rounded border border-log-line px-2 py-0.5 hover:bg-log-line disabled:opacity-50"
            >
              trace.zip
            </button>
          </li>
        ))}
      </ul>
      {message && <p className="mt-2 text-log-danger">{message}</p>}
    </div>
  );
}
