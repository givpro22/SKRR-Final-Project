import { ArrowRight, CircleAlert, Sparkles, X } from "lucide-react";
import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { errorMessage, hasErrorCode } from "@/api/errors";
import { useStartRun } from "@/api/queries/runs";
import { useScenarioDecision, useScenarioList } from "@/api/queries/scenarios";
import type { Scenario, ScenarioList, TestCase } from "@/api/types";
import { useProjectContext } from "@/app/useProjectContext";
import { Button } from "@/components/Button";
import { PageHeader } from "@/components/PageHeader";
import { Spinner } from "@/components/Spinner";
import { EmptyBlock, ErrorBlock, LoadingBlock } from "@/components/StateViews";
import { RequestFlowModal } from "@/features/requests/RequestFlowModal";
import { CaseDetailModal } from "./CaseDetailModal";
import { LEGEND, legendDotClass, scenarioStatusView } from "./labels";
import { ScenarioEditModal, RegenerateModal } from "./ScenarioModals";
import { ScenarioRow, type ScenarioAction } from "./ScenarioRow";

type Flow = { requestId: string | null } | null;
type Dialog =
  | { kind: "edit"; scenarioId: string }
  | { kind: "regenerate"; scenarioId: string }
  | { kind: "case"; scenarioId: string; testCase: TestCase }
  | null;

/** UI-02-5 테스트 시나리오 · 케이스 조회 */
export function ScenariosPage() {
  const { project } = useProjectContext();
  const { requestId = "" } = useParams();
  const navigate = useNavigate();
  const list = useScenarioList(requestId);
  const decision = useScenarioDecision(requestId);
  const startRun = useStartRun(project.id);

  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [checked, setChecked] = useState<ReadonlySet<string>>(new Set());
  const [flow, setFlow] = useState<Flow>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const data = list.data;
  const scenarios = data?.items ?? [];
  const byId = new Map(scenarios.map((s) => [s.id, s]));
  // 승인이 풀린 시나리오는 체크에서 뺀다
  const checkedApproved = scenarios.filter((s) => checked.has(s.id) && s.status === "APPROVED");

  const toggle = (setter: typeof setExpanded, id: string) =>
    setter((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const onDecision = (scenario: Scenario, action: ScenarioAction) => {
    setNotice(null);
    decision.mutate(
      { scenarioId: scenario.id, action },
      { onError: (error) => setNotice(`${scenario.code} ${action === "approve" ? "승인" : "반려"}하지 못했습니다: ${errorMessage(error)}`) },
    );
  };

  const dialogScenario = dialog ? byId.get(dialog.scenarioId) : undefined;

  const onStartRun = () => {
    setNotice(null);
    startRun.mutate(
      { testRequestId: requestId, scenarioIds: checkedApproved.map((s) => s.id) },
      {
        onSuccess: (run) => navigate(`/projects/${project.id}/runs/${run.id}/monitor`),
        onError: (error) => {
          // U3: 실행기는 플랫폼 전체에서 1건만 실행한다
          if (hasErrorCode(error, "RUN_ALREADY_ACTIVE")) setNotice("다른 실행이 진행 중이에요. 그 실행이 끝난 뒤 다시 시도해 주세요.");
          else if (hasErrorCode(error, "SCENARIO_NOT_APPROVED")) {
            setNotice("승인이 풀린 시나리오가 있어요. 목록을 새로 읽었으니 다시 확인해 주세요.");
            void list.refetch();
          } else if (hasErrorCode(error, "TARGET_URL_MISSING")) setNotice("대상 사이트 URL이 없어요. 문서 · 지식에서 대상 사이트를 먼저 등록해 주세요.");
          else setNotice(`테스트를 시작하지 못했습니다: ${errorMessage(error)}`);
        },
      },
    );
  };

  return (
    <>
      <PageHeader
        breadcrumb={[project.name, "테스트 요청", data?.testRequest.code ?? "…"]}
        title="테스트 시나리오 · 케이스 조회"
        actions={
          <>
            <Button icon={<Sparkles aria-hidden className="size-4" />} onClick={() => setFlow({ requestId: null })}>
              테스트 시나리오 생성
            </Button>
            <Button
              variant="primary"
              icon={startRun.isPending ? <Spinner className="size-4" /> : <ArrowRight aria-hidden className="size-4" />}
              disabled={checkedApproved.length === 0 || startRun.isPending}
              title={checkedApproved.length ? undefined : "승인된 시나리오를 체크해 주세요"}
              onClick={onStartRun}
            >
              테스트 실행{checkedApproved.length > 0 && ` (${checkedApproved.length})`}
            </Button>
          </>
        }
      />

      <div className="mt-8">
        {notice && (
          <div role="alert" className="mb-4 flex items-start gap-3 rounded-xl border border-danger-soft bg-surface px-4 py-3 text-xs text-danger">
            <CircleAlert aria-hidden className="mt-px size-4 shrink-0" />
            <p className="flex-1">{notice}</p>
            <button type="button" aria-label="알림 닫기" onClick={() => setNotice(null)} className="text-muted hover:text-ink">
              <X aria-hidden className="size-4" />
            </button>
          </div>
        )}

        {list.isPending ? (
          <div className="rounded-card border border-line bg-surface">
            <LoadingBlock label="시나리오를 불러오는 중" />
          </div>
        ) : list.isError ? (
          <div className="rounded-card border border-line bg-surface">
            <ErrorBlock error={list.error} onRetry={() => void list.refetch()} />
          </div>
        ) : data && data.testRequest.status !== "GENERATED" ? (
          <RequestNotReady data={data} onResume={() => setFlow({ requestId: data.testRequest.id })} />
        ) : data ? (
          <>
            <Summary summary={data.summary} />
            {scenarios.length === 0 ? (
              <div className="mt-3 rounded-card border border-line bg-surface">
                <EmptyBlock>만들어진 시나리오가 없습니다.</EmptyBlock>
              </div>
            ) : (
              <ul className="mt-3 overflow-hidden rounded-card border border-line bg-surface">
                {scenarios.map((scenario) => (
                  <ScenarioRow
                    key={scenario.id}
                    scenario={scenario}
                    checked={checked.has(scenario.id) && scenario.status === "APPROVED"}
                    expanded={expanded.has(scenario.id)}
                    busy={decision.isPending && decision.variables?.scenarioId === scenario.id}
                    onToggleCheck={() => toggle(setChecked, scenario.id)}
                    onToggleExpand={() => toggle(setExpanded, scenario.id)}
                    onEdit={() => setDialog({ kind: "edit", scenarioId: scenario.id })}
                    onDecision={(action) => onDecision(scenario, action)}
                    onRegenerate={() => setDialog({ kind: "regenerate", scenarioId: scenario.id })}
                    onOpenCase={(testCase) => setDialog({ kind: "case", scenarioId: scenario.id, testCase })}
                  />
                ))}
              </ul>
            )}
          </>
        ) : null}
      </div>

      {dialog?.kind === "edit" && dialogScenario && <ScenarioEditModal scenario={dialogScenario} onClose={() => setDialog(null)} />}
      {dialog?.kind === "regenerate" && dialogScenario && <RegenerateModal scenario={dialogScenario} onClose={() => setDialog(null)} />}
      {dialog?.kind === "case" && dialogScenario && (
        <CaseDetailModal scenario={dialogScenario} testCase={dialog.testCase} onClose={() => setDialog(null)} />
      )}
      {flow && (
        <RequestFlowModal
          projectId={project.id}
          resumeRequestId={flow.requestId}
          onClose={() => setFlow(null)}
          onDone={(id) => {
            setFlow(null);
            navigate(`/projects/${project.id}/requests/${id}/scenarios`);
          }}
        />
      )}
    </>
  );
}

function Summary({ summary }: { summary: ScenarioList["summary"] }) {
  // 범례는 0이 아닌 상태만 보인다. 각 수의 합은 total이다 (ScenarioList.summary)
  const items = LEGEND.filter((item) => summary[item.key] > 0);
  return (
    <div className="flex items-baseline justify-between">
      <h2 className="text-[15px] font-bold">
        생성된 시나리오 <span className="ml-1.5 font-mono text-[13px] font-normal text-muted">{summary.total}</span>
      </h2>
      <ul aria-label="상태별 시나리오 수" className="flex gap-4 text-xs text-ink/70">
        {items.map((item) => (
          <li key={item.key} className="flex items-center gap-1.5">
            <span aria-hidden className={`size-1.5 rounded-full ${legendDotClass[item.status]}`} />
            {scenarioStatusView[item.status].label} {summary[item.key]}
          </li>
        ))}
      </ul>
    </div>
  );
}

function RequestNotReady({ data, onResume }: { data: ScenarioList; onResume: () => void }) {
  const { testRequest } = data;
  const processing = testRequest.status === "REFINING" || testRequest.status === "GENERATING";
  // U2: 시나리오는 생성 작업이 끝난 뒤 한꺼번에 보인다. 그 전에는 대기 화면만 보인다.
  return (
    <div className="flex flex-col items-center gap-3 rounded-card border border-line bg-surface px-6 py-14 text-center">
      {processing ? (
        <>
          <Spinner className="size-6 text-accent" />
          <p className="text-[15px] font-semibold">
            {testRequest.status === "REFINING" ? "요청에 맞는 시나리오 후보를 찾고 있습니다" : "시나리오와 테스트 케이스를 만들고 있습니다"}
          </p>
          <p className="text-[13px] text-muted">끝나면 시나리오가 한꺼번에 나타납니다.</p>
        </>
      ) : testRequest.status === "AWAITING_SELECTION" ? (
        <>
          <p className="text-[15px] font-semibold">아직 시나리오 후보를 고르지 않았습니다</p>
          <p className="text-[13px] text-muted">{testRequest.rawText}</p>
          <Button variant="primary" className="mt-2" onClick={onResume}>
            후보 고르기
          </Button>
        </>
      ) : (
        <>
          <CircleAlert aria-hidden className="size-6 text-danger" />
          <p className="text-[15px] font-semibold">요청을 처리하지 못했습니다</p>
          <p className="text-[13px] text-danger">{testRequest.errorMessage ?? "AI 서버가 요청을 처리하지 못했습니다."}</p>
        </>
      )}
    </div>
  );
}
