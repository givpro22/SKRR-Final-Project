import { Check, ChevronDown, CircleAlert, ChevronRight, FlaskConical, Pencil, RotateCcw, ShieldAlert, X } from "lucide-react";
import type { Scenario, TestCase } from "@/api/types";
import { isScenarioProcessing } from "@/api/queries/scenarios";
import { Badge } from "@/components/Badge";
import { Button } from "@/components/Button";
import { Spinner } from "@/components/Spinner";
import { guardFailureKindLabel, guardLine, testCaseTypeView } from "./labels";
import { ScenarioStatusBadge } from "./ScenarioStatusBadge";
import { ScopeChips } from "./ScopeChips";

export type ScenarioAction = "approve" | "reject";

interface Props {
  scenario: Scenario;
  checked: boolean;
  expanded: boolean;
  /** 이 시나리오에 진행 중인 요청 */
  busy: boolean;
  onToggleCheck: () => void;
  onToggleExpand: () => void;
  onEdit: () => void;
  onDecision: (action: ScenarioAction) => void;
  onRegenerate: () => void;
  onOpenCase: (testCase: TestCase) => void;
}

export function ScenarioRow({
  scenario,
  checked,
  expanded,
  busy,
  onToggleCheck,
  onToggleExpand,
  onEdit,
  onDecision,
  onRegenerate,
  onOpenCase,
}: Props) {
  const processing = isScenarioProcessing(scenario.status);
  const approved = scenario.status === "APPROVED";
  const line = guardLine(scenario);
  // GUARD_FAILED를 사람이 고치면 REVIEW_REQUIRED가 되지만 직전 AI 가드 결과는 남는다
  const hasPreviousGuard = scenario.status !== "GUARD_FAILED" && scenario.status !== "GUARD_RETRY" && scenario.guard.failures.length > 0;
  const panelId = `scenario-panel-${scenario.id}`;

  return (
    <li data-testid={`scenario-${scenario.code}`} className="border-b border-line last:border-b-0">
      <div className="flex min-h-[54px] items-center gap-3 px-5 py-2.5">
        {/* 승인된 시나리오만 실행에 넣을 수 있다 (FR-03) */}
        <input
          type="checkbox"
          aria-label={`${scenario.code} 실행에 포함`}
          checked={checked}
          disabled={!approved}
          title={approved ? undefined : "승인된 시나리오만 실행할 수 있습니다"}
          onChange={onToggleCheck}
          className="size-[18px] shrink-0 cursor-pointer accent-ink disabled:cursor-not-allowed"
        />
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={panelId}
          aria-label={`${scenario.code} ${expanded ? "접기" : "펼치기"}`}
          onClick={onToggleExpand}
          className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted hover:bg-page hover:text-ink"
        >
          {expanded ? <ChevronDown aria-hidden className="size-4" /> : <ChevronRight aria-hidden className="size-4" />}
        </button>
        <span className="w-12 shrink-0 font-mono text-xs text-muted">{scenario.code}</span>
        <button type="button" onClick={onToggleExpand} className="min-w-0 flex-1 truncate text-left text-sm font-semibold">
          {scenario.title}
        </button>

        <span className="flex shrink-0 items-center gap-2.5">
          {processing ? (
            <span className="inline-flex items-center gap-1.5 text-xs text-muted">
              <Spinner className="size-3.5" />
              생성 중
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 text-xs text-ink/80">
              <FlaskConical aria-hidden className="size-3.5" strokeWidth={1.75} />
              케이스 {scenario.caseCount}
            </span>
          )}
          <ScopeChips scopes={scenario.scopes} />
          {scenario.requirementRef && (
            <button
              type="button"
              onClick={() => {
                if (!expanded) onToggleExpand();
              }}
              title="근거 문서 보기"
              className="font-mono text-xs text-accent hover:underline"
            >
              {scenario.requirementRef}
            </button>
          )}
          <ScenarioStatusBadge status={scenario.status} />
          <button
            type="button"
            aria-label={`${scenario.code} 수정`}
            disabled={processing}
            onClick={onEdit}
            className="flex size-8 items-center justify-center rounded-lg text-ink/70 hover:bg-page hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Pencil aria-hidden className="size-4" strokeWidth={1.75} />
          </button>
        </span>
      </div>

      {line && (
        <p className="flex items-center gap-1.5 pr-5 pb-3 pl-[102px] text-xs text-danger">
          <ShieldAlert aria-hidden className="size-3.5 shrink-0" />
          <span>{line}</span>
          {scenario.status === "GUARD_FAILED" && (
            <span className="font-semibold">
              {scenario.guard.catalogGap ? "· 카탈로그 수정 필요" : "· 다시 생성해 주세요"}
            </span>
          )}
        </p>
      )}

      {!line && !processing && scenario.guard.message && (
        // 재생성 실패("재생성 실패: …")이거나, GUARD_FAILED를 사람이 고쳐 남은 이전 가드 결과 (state-machines.md Scenario)
        <p className="flex items-center gap-1.5 pr-5 pb-3 pl-[102px] text-xs text-warning">
          <CircleAlert aria-hidden className="size-3.5 shrink-0" />
          <span>
            {hasPreviousGuard && !scenario.guard.message.startsWith("재생성 실패") && "이전 생성의 가드 결과 · "}
            {scenario.guard.message}
          </span>
        </p>
      )}

      {expanded && (
        <div id={panelId} className="px-5 pb-4">
          <div className="ml-[52px] border-l-2 border-line-strong/40 pl-6">
            <ScenarioActions scenario={scenario} busy={busy} onDecision={onDecision} onRegenerate={onRegenerate} />
            {scenario.guard.failures.length > 0 && !processing && <GuardFailures scenario={scenario} previous={hasPreviousGuard} />}
            {scenario.references && scenario.references.length > 0 && <References scenario={scenario} />}
            <CaseTable scenario={scenario} onOpenCase={onOpenCase} />
          </div>
        </div>
      )}
    </li>
  );
}

// 승인·반려·재생성은 캡처에 없어 펼친 영역 위에 같은 스타일의 버튼으로 두었다 (디자인 확인 필요)
function ScenarioActions({
  scenario,
  busy,
  onDecision,
  onRegenerate,
}: {
  scenario: Scenario;
  busy: boolean;
  onDecision: (action: ScenarioAction) => void;
  onRegenerate: () => void;
}) {
  const { status } = scenario;
  if (isScenarioProcessing(status)) {
    return (
      <p className="flex items-center gap-2 py-2 text-xs text-muted">
        <Spinner className="size-3.5" />
        시나리오를 다시 만들고 있습니다. 끝나면 목록이 자동으로 바뀝니다.
      </p>
    );
  }
  const hint: Record<string, string> = {
    REVIEW_REQUIRED: "내용과 기대값을 확인한 뒤 승인해 주세요. 승인된 시나리오만 실행할 수 있습니다.",
    APPROVED: "승인됨. 내용을 고치거나 다시 만들면 승인이 풀립니다.",
    REJECTED: "반려됨. 다시 만들면 검토할 수 있습니다.",
    GUARD_FAILED: scenario.guard.catalogGap
      ? "카탈로그에 없는 화면 요소가 있어 다시 만들어도 같은 결과가 나옵니다. 카탈로그를 고친 뒤 다시 만들어 주세요."
      : "가드 검증을 3회 통과하지 못했습니다. 다시 만들어 주세요.",
  };
  return (
    <div className="flex items-center justify-between gap-3 py-2">
      <p className="text-xs text-muted">{hint[status]}</p>
      <span className="flex shrink-0 gap-2">
        {status === "REVIEW_REQUIRED" && (
          <Button size="sm" variant="ghost" disabled={busy} icon={<X aria-hidden className="size-3.5" />} onClick={() => onDecision("reject")}>
            반려
          </Button>
        )}
        <Button size="sm" disabled={busy} icon={<RotateCcw aria-hidden className="size-3.5" />} onClick={onRegenerate}>
          다시 생성
        </Button>
        {status === "REVIEW_REQUIRED" && (
          <Button size="sm" variant="primary" disabled={busy} icon={<Check aria-hidden className="size-3.5" />} onClick={() => onDecision("approve")}>
            승인
          </Button>
        )}
      </span>
    </div>
  );
}

function GuardFailures({ scenario, previous }: { scenario: Scenario; previous: boolean }) {
  return (
    <div className="mb-2 rounded-xl bg-danger-row px-4 py-3">
      {previous && (
        <p className="mb-1.5 text-xs text-ink/70">
          <span className="font-semibold">이전 생성의 가드 결과</span> · 사람이 고친 내용은 실행 전에 카탈로그·명세와 다시 대조합니다.
        </p>
      )}
      <ul aria-label={previous ? "이전 생성의 가드 실패 항목" : "가드 실패 항목"} className="flex flex-col gap-1">
        {scenario.guard.failures.map((failure, index) => (
          <li key={`${failure.kind}-${index}`} className="flex items-baseline gap-2 text-xs">
            <Badge tone={failure.kind === "CATALOG_GAP" ? "danger" : "muted"} className="h-5">
              {guardFailureKindLabel[failure.kind]}
            </Badge>
            <span className="text-ink/80">{failure.message}</span>
            {failure.subject && <span className="font-mono text-muted">{failure.subject}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

function References({ scenario }: { scenario: Scenario }) {
  return (
    <div className="mb-2 rounded-xl bg-page px-4 py-3">
      <p className="text-xs font-semibold">근거 문서</p>
      <ul className="mt-1.5 flex flex-col gap-1">
        {scenario.references?.map((ref) => (
          <li key={`${ref.sourceType}-${ref.sourceId}`} className="text-xs text-ink/80">
            <span className="font-mono text-accent">{ref.sourceId}</span>
            {ref.title && <span className="ml-1.5 font-medium">{ref.title}</span>}
            <span className="ml-1.5 text-muted">{ref.excerpt}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function CaseTable({ scenario, onOpenCase }: { scenario: Scenario; onOpenCase: (testCase: TestCase) => void }) {
  const cases = scenario.testCases.filter((c) => c.isActive).sort((a, b) => a.order - b.order);
  if (cases.length === 0) {
    return <p className="py-4 text-xs text-muted">테스트 케이스가 없습니다.</p>;
  }
  return (
    <table className="w-full table-fixed text-left">
      <thead>
        <tr className="border-b border-line text-xs text-ink/70">
          <th className="w-14 py-2.5 font-medium">ID</th>
          <th className="py-2.5 font-medium">테스트 케이스</th>
          <th className="w-16 py-2.5 font-medium">유형</th>
          <th className="w-[116px] py-2.5 font-medium">검증 범위</th>
          <th className="w-[290px] py-2.5 font-medium">예상 결과</th>
          <th className="w-8" aria-label="상세" />
        </tr>
      </thead>
      <tbody>
        {cases.map((testCase) => {
          const type = testCaseTypeView[testCase.type];
          return (
            <tr
              key={testCase.id}
              onClick={() => onOpenCase(testCase)}
              className="cursor-pointer border-b border-line last:border-b-0 hover:bg-accent-row"
            >
              <td className="py-3 font-mono text-xs text-muted">{testCase.code}</td>
              <td className="truncate py-3 pr-3 text-[13px] font-medium">{testCase.title}</td>
              <td className="py-3">
                <Badge tone={type.tone} className="h-[22px] px-2">
                  {type.label}
                </Badge>
              </td>
              <td className="py-3">
                <ScopeChips scopes={testCase.scopes} />
              </td>
              <td className="truncate py-3 pr-3 text-xs text-ink/70">{testCase.expectedResult}</td>
              <td className="py-3">
                <button
                  type="button"
                  aria-label={`${testCase.code} 상세`}
                  onClick={(event) => {
                    event.stopPropagation();
                    onOpenCase(testCase);
                  }}
                  className="flex size-6 items-center justify-center text-muted hover:text-ink"
                >
                  <ChevronRight aria-hidden className="size-4" />
                </button>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
