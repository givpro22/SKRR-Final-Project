import { Clock, FileStack, Monitor, RotateCcw, User } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { errorMessage, hasErrorCode } from "@/api/errors";
import { useRerunRun, useRunReport } from "@/api/queries/reports";
import type { DocumentType, RunReport } from "@/api/types";
import { useProjectContext } from "@/app/useProjectContext";
import { Button } from "@/components/Button";
import { PageHeader } from "@/components/PageHeader";
import { ErrorBlock, LoadingBlock } from "@/components/StateViews";
import { formatDuration } from "@/features/runs/labels";
import { CaseDetailPanel } from "./CaseDetailPanel";
import { documentShortLabel } from "./labels";
import { ScenarioResults } from "./ScenarioResults";

const DOC_TYPES: DocumentType[] = ["REQUIREMENT", "API_SPEC", "CATALOG", "TEST_DATA"];
const dateTime = new Intl.DateTimeFormat("ko-KR", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
const clock = new Intl.DateTimeFormat("ko-KR", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });

/** UI-04 결과 리포트 */
export function ReportPage() {
  const { project } = useProjectContext();
  const { runId = "" } = useParams();
  const report = useRunReport(runId);

  if (report.isPending) return <LoadingBlock className="mt-24" label="리포트를 불러오는 중" />;
  if (report.isError) {
    // 실행이 끝나기 전에는 409 RUN_NOT_FINISHED → 실행 모니터로 안내
    if (hasErrorCode(report.error, "RUN_NOT_FINISHED")) {
      return (
        <div className="mt-24 flex flex-col items-center gap-3 text-center text-[13px]">
          <p className="text-[15px] font-semibold">아직 실행이 끝나지 않았어요</p>
          <p className="text-muted">실행이 끝나면 결과 리포트를 볼 수 있습니다.</p>
          <Link to={`/projects/${project.id}/runs/${runId}/monitor`} className="text-accent hover:underline">
            실행 모니터로 가기
          </Link>
        </div>
      );
    }
    return <ErrorBlock className="mt-24" error={report.error} onRetry={() => void report.refetch()} />;
  }
  return <Report report={report.data} />;
}

function Report({ report }: { report: RunReport }) {
  const { project } = useProjectContext();
  const navigate = useNavigate();
  const { run, kpis } = report;
  const rerun = useRerunRun(run.id, project.id);
  const [notice, setNotice] = useState<string | null>(null);

  const allCases = report.scenarios.flatMap((s) => s.cases);
  // 상세 탐색 대상: 실패 → 실행 오류 순. 없으면 첫 케이스
  const problemCases = [...allCases.filter((c) => c.status === "FAILED"), ...allCases.filter((c) => c.status === "ERROR")];
  const [selectedId, setSelectedId] = useState<string | null>(problemCases[0]?.caseResultId ?? allCases[0]?.caseResultId ?? null);
  const navIndex = problemCases.findIndex((c) => c.caseResultId === selectedId);
  const move = (delta: number) => {
    const next = problemCases[(navIndex + delta + problemCases.length) % problemCases.length];
    if (next) setSelectedId(next.caseResultId);
  };

  const startRerun = (caseResultIds: string[]) => {
    setNotice(null);
    rerun.mutate(caseResultIds, {
      onSuccess: (next) => navigate(`/projects/${project.id}/runs/${next.id}/monitor`),
      onError: (error) => {
        if (hasErrorCode(error, "RUN_ALREADY_ACTIVE")) setNotice("다른 실행이 진행 중이에요. 그 실행이 끝난 뒤 다시 시도해 주세요.");
        else if (hasErrorCode(error, "SCENARIO_NOT_APPROVED")) setNotice("승인이 풀린 시나리오가 있어 재실행할 수 없어요. 시나리오를 다시 승인해 주세요.");
        else if (hasErrorCode(error, "TARGET_URL_MISSING")) setNotice("대상 사이트 URL이 없어요. 문서 · 지식에서 대상 사이트를 먼저 등록해 주세요.");
        else setNotice(`재실행하지 못했습니다: ${errorMessage(error)}`);
      },
    });
  };

  const failedScenarioCodes = report.scenarios.filter((s) => s.cases.some((c) => c.status === "FAILED")).map((s) => s.code);
  const docs = DOC_TYPES.filter((t) => run.documentVersions[t] != null).map((t) => `${documentShortLabel[t]} v${run.documentVersions[t]}`);
  let target = run.targetUrl;
  try {
    target = new URL(run.targetUrl).host;
  } catch {
    // 형식이 다르면 그대로 보인다
  }

  return (
    <>
      <PageHeader
        breadcrumb={[project.name, "리포트", `${run.code} · ${dateTime.format(new Date(run.finishedAt ?? run.createdAt))}`]}
        title="테스트 결과 리포트"
        actions={
          <>
            {/* PDF 내보내기는 MVP 이후(ADR-013)라 버튼을 두지 않는다 */}
            <Button
              variant="primary"
              icon={<RotateCcw aria-hidden className="size-4" />}
              disabled={kpis.failedCases === 0 || rerun.isPending}
              title={kpis.failedCases === 0 ? "재실행할 실패 케이스가 없습니다" : undefined}
              onClick={() => startRerun([])}
            >
              실패 {kpis.failedCases}건 재실행
            </Button>
          </>
        }
      />

      {notice && (
        <div role="alert" className="mt-5 rounded-xl border border-danger-soft bg-surface px-4 py-3 text-xs text-danger">
          {notice}
        </div>
      )}
      {run.errorMessage && (
        <div role="note" className="mt-5 rounded-xl bg-warning-soft px-4 py-3 text-xs text-warning">
          실행 오류: {run.errorMessage}
        </div>
      )}

      <dl className="mt-6 grid grid-cols-4 gap-6">
        <Meta icon={<Monitor aria-hidden className="size-3.5" />} label="대상">
          {target}
          {run.targetBuild && ` · 빌드 ${run.targetBuild}`}
        </Meta>
        <Meta icon={<Monitor aria-hidden className="size-3.5" />} label="환경">
          {run.browser} · {run.viewportWidth}×{run.viewportHeight}
        </Meta>
        <Meta icon={<User aria-hidden className="size-3.5" />} label="실행">
          {run.startedBy?.displayName ?? "-"}
          {run.startedAt && ` · ${clock.format(new Date(run.startedAt))}`}
          {run.finishedAt && ` – ${clock.format(new Date(run.finishedAt))}`}
        </Meta>
        <Meta icon={<FileStack aria-hidden className="size-3.5" />} label="기준 문서">
          {docs.length ? docs.join(" · ") : "-"}
        </Meta>
      </dl>

      <ul aria-label="결과 지표" className="mt-6 grid grid-cols-5 divide-x divide-line overflow-hidden rounded-card border border-line bg-surface">
        <Kpi label="시나리오 통과" value={`${kpis.scenariosPassed} / ${kpis.scenariosTotal}`} sub="선택한 시나리오 기준" />
        <Kpi label="케이스 통과" value={`${kpis.casesPassed} / ${kpis.casesTotal}`} sub={`통과율 ${kpis.casePassRatePct}%`} />
        <Kpi
          label="실패 케이스"
          value={String(kpis.failedCases)}
          danger={kpis.failedCases > 0}
          sub={[failedScenarioCodes.join(" · "), kpis.errorCases ? `실행 오류 ${kpis.errorCases}건 별도` : ""].filter(Boolean).join(" · ") || "없음"}
        />
        <Kpi label="교차 검증 불일치" value={String(kpis.crossCheckMismatches)} danger={kpis.crossCheckMismatches > 0} sub="UI · API ↔ DB" />
        <Kpi label="총 소요" value={formatDuration(kpis.durationMs) || "-"} sub={`API 호출 ${kpis.apiCallCount}건`} icon={<Clock aria-hidden className="size-3.5" />} />
      </ul>

      <div className="mt-6 grid grid-cols-[440px_minmax(0,1fr)] gap-6">
        <ScenarioResults report={report} selectedId={selectedId} onSelect={setSelectedId} />
        {selectedId ? (
          <CaseDetailPanel
            key={selectedId}
            caseResultId={selectedId}
            runCode={run.code}
            nav={navIndex >= 0 ? { index: navIndex, total: problemCases.length, prev: () => move(-1), next: () => move(1) } : null}
            onRerunCase={(id) => startRerun([id])}
            rerunBusy={rerun.isPending}
          />
        ) : (
          <p className="rounded-card border border-line bg-surface px-5 py-10 text-center text-xs text-muted">이 실행에 케이스가 없습니다</p>
        )}
      </div>
    </>
  );
}

function Meta({ icon, label, children }: { icon: ReactNode; label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="flex items-center gap-1.5 text-xs text-muted">
        {icon}
        {label}
      </dt>
      <dd className="mt-1.5 truncate text-[13px] font-semibold">{children}</dd>
    </div>
  );
}

function Kpi({ label, value, sub, danger, icon }: { label: string; value: string; sub: string; danger?: boolean; icon?: ReactNode }) {
  return (
    <li className="px-5 py-5">
      <p className="flex items-center gap-1.5 text-xs text-muted">
        {icon}
        {label}
      </p>
      <p className={`mt-2 font-mono text-[28px] font-semibold tracking-tight ${danger ? "text-danger" : ""}`}>{value}</p>
      <p className="mt-1 truncate text-xs text-muted">{sub}</p>
    </li>
  );
}
