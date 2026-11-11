import clsx from "clsx";
import { ArrowUp, Check, ChevronLeft, ChevronRight, CircleAlert, CircleX, Code2, FileArchive, FileText, Image, Loader, Network, RotateCcw, TriangleAlert, Wrench, X } from "lucide-react";
import { useState, type ReactNode } from "react";
import { errorMessage } from "@/api/errors";
import { fetchArtifactLink, useCaseSpec } from "@/api/queries/runs";
import { isAnalysisPending, useCaseResult } from "@/api/queries/reports";
import type { ArtifactRef, CaseResultDetail, RunStep, Verification } from "@/api/types";
import { Badge } from "@/components/Badge";
import { Button } from "@/components/Button";
import { CodeText } from "@/components/CodeText";
import { Modal } from "@/components/Modal";
import { ErrorBlock, LoadingBlock } from "@/components/StateViews";
import { openLink } from "@/lib/download";
import { specFileName, stripAnsi } from "@/features/runs/runView";
import { failureTypeLabel, isFlaky, schemaCheckLabel, severityView, verdictView } from "./labels";

interface Props {
  caseResultId: string;
  runCode: string;
  /** 실패·오류 케이스 사이를 오가는 탐색 (UI-04 "실패 1 / 2") */
  nav: { index: number; total: number; prev: () => void; next: () => void } | null;
  onRerunCase: (caseResultId: string) => void;
  rerunBusy: boolean;
}

export function CaseDetailPanel({ caseResultId, runCode, nav, onRerunCase, rerunBusy }: Props) {
  const detail = useCaseResult(caseResultId);
  if (detail.isPending) return <Panel><LoadingBlock label="케이스 결과를 불러오는 중" /></Panel>;
  if (detail.isError) return <Panel><ErrorBlock error={detail.error} onRetry={() => void detail.refetch()} /></Panel>;
  const d = detail.data;
  const failed = d.status === "FAILED";
  const error = d.status === "ERROR";
  const StatusIcon = failed ? CircleX : error ? CircleAlert : Check;

  return (
    <Panel>
      <div className="flex items-start gap-3 border-b border-line px-5 py-4" data-testid="case-detail">
        <StatusIcon aria-hidden className={clsx("mt-0.5 size-5 shrink-0", failed ? "text-danger" : error ? "text-warning" : "text-success")} />
        <div className="min-w-0 flex-1">
          <h2 className="text-[15px] font-bold">
            <span className="font-mono">{d.code}</span> {d.title}
          </h2>
          <p className="mt-0.5 truncate text-xs text-muted">
            {[`${d.scenarioCode} ${d.scenarioTitle}`, d.requirementRef].filter(Boolean).join(" · ")}
          </p>
        </div>
        {nav && (
          <div className="flex shrink-0 items-center gap-1.5">
            <span className="font-mono text-xs text-ink/70">
              실패 {nav.index + 1} / {nav.total}
            </span>
            <button type="button" aria-label="이전 실패" disabled={nav.total < 2} onClick={nav.prev} className="flex size-8 items-center justify-center rounded-lg border border-line-strong/60 hover:bg-page disabled:opacity-40">
              <ChevronLeft aria-hidden className="size-4" />
            </button>
            <button type="button" aria-label="다음 실패" disabled={nav.total < 2} onClick={nav.next} className="flex size-8 items-center justify-center rounded-lg border border-line-strong/60 hover:bg-page disabled:opacity-40">
              <ChevronRight aria-hidden className="size-4" />
            </button>
          </div>
        )}
        <Button size="sm" className="h-9 shrink-0" icon={<RotateCcw aria-hidden className="size-3.5" />} disabled={rerunBusy} onClick={() => onRerunCase(d.id)}>
          이 케이스 재실행
        </Button>
      </div>

      {error && (
        <div role="note" className="mx-5 mt-4 flex gap-2 rounded-xl bg-warning-soft px-4 py-3 text-xs text-warning">
          <CircleAlert aria-hidden className="mt-px size-4 shrink-0" />
          <p>
            <span className="font-semibold">실행 오류</span> · 환경 문제로 판정하지 못한 케이스입니다. 제품 결함(실패)과 따로 셉니다.
            {d.failureMessage && <span className="mt-1 block text-ink/70">{stripAnsi(d.failureMessage)}</span>}
          </p>
        </div>
      )}

      <Facts d={d} runCode={runCode} />
      {d.verifications.length > 0 ? (
        <CrossCheck items={d.verifications} />
      ) : (
        (failed || error) && (
          // 실행기 시도가 실패하면 사후 조회·교차 검증 단계를 건너뛴다 (state-machines "API 검사와 교차 검증 판정")
          <Section title="화면 · API · DB 교차 검증">
            <p className="rounded-xl bg-page px-4 py-3 text-xs text-muted">실행 단계에서 실패해 교차 검증을 하지 않았어요</p>
          </Section>
        )
      )}
      {d.reproductionSteps.length > 0 && <Steps steps={d.reproductionSteps} />}
      <RootCauses d={d} />
      <Evidence d={d} />
    </Panel>
  );
}

function Panel({ children }: { children: ReactNode }) {
  return <section aria-label="케이스 상세" className="overflow-hidden rounded-card border border-line bg-surface pb-5">{children}</section>;
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="px-5 pt-5">
      <h3 className="text-[13px] font-bold">{title}</h3>
      <div className="mt-2">{children}</div>
    </section>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="mt-1.5 text-[13px] font-semibold">{children}</dd>
    </div>
  );
}

function Facts({ d, runCode }: { d: CaseResultDetail; runCode: string }) {
  const severity = d.severity ? severityView[d.severity] : null;
  return (
    <dl className="grid grid-cols-5 gap-3 border-b border-line px-5 py-4">
      <Fact label="심각도">
        {severity ? (
          <Badge tone={severity.tone} icon={d.severity === "HIGH" || d.severity === "CRITICAL" ? <ArrowUp aria-hidden className="size-3" /> : undefined}>
            {severity.label}
          </Badge>
        ) : (
          <span className="font-normal text-muted">{isAnalysisPending(d.analysisStatus) ? "분석 중" : "-"}</span>
        )}
      </Fact>
      <Fact label="실패 유형">{d.failureType ? failureTypeLabel[d.failureType] : "-"}</Fact>
      <Fact label="재현">
        <span className="flex items-center gap-1.5">
          {d.attempts}회 중 {d.failedAttempts}회
          {d.status === "FAILED" && isFlaky(d.attempts, d.failedAttempts) && (
            <Badge tone="warning" className="h-5 px-2">
              불안정
            </Badge>
          )}
        </span>
      </Fact>
      <Fact label="영향 기능">{d.affectedFeatures.length ? d.affectedFeatures.join(" · ") : "-"}</Fact>
      <Fact label="처음 발생">{d.firstSeenRunCode ? (d.firstSeenRunCode === runCode ? "이번 실행" : d.firstSeenRunCode) : "-"}</Fact>
    </dl>
  );
}

/** 표시 값이 다른 값(기대값, 없으면 다수 값)과 다르면 경고 표시한다 */
function outliers(v: Verification): Set<"ui" | "api" | "db"> {
  const values = { ui: v.uiValue, api: v.apiValue, db: v.dbValue };
  const present = Object.entries(values).filter((e): e is [string, string] => e[1] != null);
  let reference = v.expectedValue ?? null;
  if (reference == null) {
    const counts = new Map<string, number>();
    for (const [, value] of present) counts.set(value, (counts.get(value) ?? 0) + 1);
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
    reference = top && top[1] > 1 ? top[0] : null;
  }
  const out = new Set<"ui" | "api" | "db">();
  if (v.verdict !== "MISMATCH" || reference == null) return out;
  for (const [key, value] of present) if (value !== reference && (key === "ui" || key === "api" || key === "db")) out.add(key);
  return out;
}

function CrossCheck({ items }: { items: Verification[] }) {
  return (
    <Section title="화면 · API · DB 교차 검증">
      <table className="w-full text-left text-[13px]">
        <thead>
          <tr className="border-b border-line text-xs text-ink/70">
            <th className="w-[28%] py-2 font-medium">검증 항목</th>
            <th className="w-[18%] py-2 font-medium">UI</th>
            <th className="w-[18%] py-2 font-medium">API</th>
            <th className="w-[18%] py-2 font-medium">DB</th>
            <th className="py-2 font-medium">판정</th>
          </tr>
        </thead>
        <tbody>
          {[...items]
            .sort((a, b) => a.order - b.order)
            .map((v) => {
              const bad = outliers(v);
              const verdict = verdictView[v.verdict];
              const allSame = v.uiValue != null && v.uiValue === v.apiValue && v.apiValue === v.dbValue;
              return (
                <tr key={v.order} className="border-b border-line last:border-b-0">
                  <td className="py-3 pr-2">
                    {v.itemLabel}
                    {/* 세 값이 같은데 기대값과 달라 불일치인 경우 기대값을 함께 보인다 */}
                    {v.verdict === "MISMATCH" && allSame && v.expectedValue != null && (
                      <span className="mt-0.5 block font-mono text-xs text-danger">기대 {v.expectedValue}</span>
                    )}
                  </td>
                  {(["ui", "api", "db"] as const).map((key) => {
                    const value = key === "ui" ? v.uiValue : key === "api" ? v.apiValue : v.dbValue;
                    return (
                      <td key={key} className={clsx("py-3 font-mono", bad.has(key) && "text-danger")}>
                        {bad.has(key) && <TriangleAlert aria-label="불일치 값" className="mr-1 inline size-3.5 -translate-y-px" />}
                        {value ?? <span className="text-muted">-</span>}
                      </td>
                    );
                  })}
                  <td className="py-3">
                    <Badge tone={verdict.tone} icon={v.verdict === "MATCH" ? <Check aria-hidden className="size-3" /> : v.verdict === "MISMATCH" ? <X aria-hidden className="size-3" /> : undefined}>
                      {verdict.label}
                    </Badge>
                  </td>
                </tr>
              );
            })}
        </tbody>
      </table>
    </Section>
  );
}

function Steps({ steps }: { steps: RunStep[] }) {
  return (
    <Section title="재현 단계">
      <ol className="flex flex-col gap-1">
        {[...steps]
          .sort((a, b) => a.order - b.order)
          .map((step) => {
            const failed = step.status === "FAILED";
            return (
              <li key={step.id} data-status={step.status} className={clsx("rounded-lg px-3 py-2.5 text-[13px]", failed && "bg-danger-soft")}>
                <div className="flex items-start gap-3">
                  {failed ? <X aria-hidden className="mt-0.5 size-4 shrink-0 text-danger" /> : step.status === "PASSED" ? <Check aria-hidden className="mt-0.5 size-4 shrink-0 text-success" /> : <span aria-hidden className="mt-0.5 size-4 shrink-0 text-center text-muted">·</span>}
                  <span className="w-4 shrink-0 font-mono text-xs leading-5 text-muted">{step.order}</span>
                  <span className={clsx("min-w-0 flex-1", failed && "font-semibold")}>
                    <CodeText text={step.title} />
                  </span>
                  <span className={clsx("max-w-[45%] shrink-0 text-right font-mono text-xs", failed ? "text-danger" : "text-ink/70")}>
                    {failed && (step.expectedValue || step.actualValue)
                      ? `예상 ${step.expectedValue ?? "-"} · 실제 ${step.actualValue ?? "-"}`
                      : (step.actualValue ?? "")}
                  </span>
                </div>
                {step.schemaCheck === "FAILED" && (
                  <p className="mt-1 pl-14 text-xs text-danger">
                    {schemaCheckLabel.FAILED}: {stripAnsi(step.detail ?? "")}
                  </p>
                )}
                {failed && step.detail && step.schemaCheck !== "FAILED" && (
                  <p className="mt-1 pl-14 font-mono text-xs whitespace-pre-wrap text-ink/70">{stripAnsi(step.detail)}</p>
                )}
              </li>
            );
          })}
      </ol>
    </Section>
  );
}

function RootCauses({ d }: { d: CaseResultDetail }) {
  if (d.analysisStatus === "NOT_REQUIRED") return null;
  return (
    <Section title="원인 후보 · AI 분석">
      {isAnalysisPending(d.analysisStatus) ? (
        <p role="status" className="flex items-center gap-2 rounded-xl bg-page px-4 py-3 text-xs text-ink/70">
          <Loader aria-hidden className="size-3.5 animate-spin text-accent" />
          분석 중 · AI가 실행 기록을 바탕으로 원인을 찾고 있어요
        </p>
      ) : d.analysisStatus === "FAILED" ? (
        <p role="alert" className="rounded-xl bg-danger-soft px-4 py-3 text-xs text-danger">
          분석 실패{d.analysisError ? `: ${d.analysisError}` : ""}
        </p>
      ) : d.rootCauses.length === 0 ? (
        <p className="rounded-xl bg-page px-4 py-3 text-xs text-muted">근거 있는 원인 후보를 찾지 못했어요</p>
      ) : (
        <ol className="flex flex-col gap-1">
          {[...d.rootCauses]
            .sort((a, b) => a.rank - b.rank)
            .map((cause, i) => (
              <li key={cause.rank} className={clsx("rounded-xl px-4 py-3", i === 0 ? "border border-danger-soft bg-danger-row" : "")}>
                <div className="flex items-center gap-3">
                  <span className={clsx("w-4 font-mono text-xs", i === 0 ? "font-semibold text-danger" : "text-muted")}>{cause.rank}</span>
                  <span className={clsx("min-w-0 flex-1 text-[13px]", i === 0 && "font-semibold")}>
                    <CodeText text={cause.description} />
                  </span>
                  <span aria-hidden className="h-1 w-20 overflow-hidden rounded-full bg-line">
                    <span className={clsx("block h-full", i === 0 ? "bg-danger" : "bg-muted")} style={{ width: `${cause.confidencePct}%` }} />
                  </span>
                  <span className={clsx("w-9 text-right font-mono text-xs", i === 0 ? "text-danger" : "text-muted")}>{cause.confidencePct}%</span>
                </div>
                {i === 0 && (
                  <div className="mt-2 flex flex-col gap-1 pl-7 text-xs">
                    {cause.evidence.map((e, j) => (
                      <p key={j} className="flex items-start gap-1.5 font-mono text-ink/70">
                        <FileText aria-hidden className="mt-px size-3.5 shrink-0" />
                        <span>
                          근거 <CodeText text={e} />
                        </span>
                      </p>
                    ))}
                    {cause.remediation && (
                      <p className="flex items-start gap-1.5 text-success">
                        <Wrench aria-hidden className="mt-px size-3.5 shrink-0" />
                        <span>
                          해결 방안 <CodeText text={cause.remediation} />
                        </span>
                      </p>
                    )}
                  </div>
                )}
              </li>
            ))}
        </ol>
      )}
    </Section>
  );
}

const artifactView: Record<ArtifactRef["type"], { label: string; icon: typeof Image }> = {
  SCREENSHOT: { label: "실패 스크린샷", icon: Image },
  TRACE: { label: "Playwright trace", icon: FileArchive },
  HAR: { label: "HAR", icon: Network },
  SPEC: { label: "spec", icon: Code2 },
};

function Evidence({ d }: { d: CaseResultDetail }) {
  const [message, setMessage] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [showSpec, setShowSpec] = useState(false);
  // 스크린샷은 마지막 것(실패 시점)만, trace·HAR는 각각 마지막 것만 버튼으로 둔다
  const latest = (type: ArtifactRef["type"]) => [...d.artifacts].filter((a) => a.type === type).sort((a, b) => a.createdAt.localeCompare(b.createdAt)).at(-1);
  const buttons = (["SCREENSHOT", "TRACE", "HAR"] as const).map((type) => ({ type, artifact: latest(type) })).filter((b) => b.artifact);

  const open = async (artifact: ArtifactRef) => {
    setMessage(null);
    try {
      const link = await fetchArtifactLink(artifact.id);
      if (artifact.type === "SCREENSHOT") setPreview(link.url);
      else openLink(link.url, artifact.type === "TRACE" ? `${d.code.toLowerCase()}-trace.zip` : `${d.code.toLowerCase()}.har`);
    } catch (error) {
      setMessage(`증거를 받지 못했습니다: ${errorMessage(error)}`);
    }
  };

  return (
    <Section title="실행 증거">
      <div className="flex flex-wrap gap-2">
        {buttons.map(({ type, artifact }) => {
          const view = artifactView[type];
          return (
            <Button key={type} size="sm" className="h-9" icon={<view.icon aria-hidden className="size-3.5" />} onClick={() => artifact && void open(artifact)}>
              {view.label}
            </Button>
          );
        })}
        <Button size="sm" className="h-9" icon={<Code2 aria-hidden className="size-3.5" />} onClick={() => setShowSpec(true)}>
          {specFileName(d.code)}
        </Button>
      </div>
      {buttons.length === 0 && <p className="mt-2 text-xs text-muted">저장된 스크린샷·trace·HAR가 없습니다</p>}
      {message && <p className="mt-2 text-xs text-danger">{message}</p>}
      <Modal open={preview !== null} width="xl" title={`${d.code} 실패 스크린샷`} onClose={() => setPreview(null)}>
        {preview && <img src={preview} alt={`${d.code} 실패 스크린샷`} className="w-full rounded-lg border border-line" />}
      </Modal>
      {showSpec && <SpecModal caseResultId={d.id} code={d.code} onClose={() => setShowSpec(false)} />}
    </Section>
  );
}

function SpecModal({ caseResultId, code, onClose }: { caseResultId: string; code: string; onClose: () => void }) {
  const spec = useCaseSpec(caseResultId);
  return (
    <Modal open width="xl" title={specFileName(code)} onClose={onClose}>
      {spec.isPending ? (
        <LoadingBlock />
      ) : spec.isError ? (
        <ErrorBlock error={spec.error} />
      ) : (
        <pre className="max-h-[60vh] overflow-auto rounded-xl bg-log p-4 font-mono text-xs leading-5 text-log-text">{spec.data.source}</pre>
      )}
    </Modal>
  );
}
