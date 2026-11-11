import clsx from "clsx";
import { ArrowRightLeft, ChevronDown, ChevronRight, CircleAlert, CircleCheck, CircleX, Info, Percent } from "lucide-react";
import { useState } from "react";
import type { ReportCaseItem, ReportScenario, RunReport } from "@/api/types";
import { Badge } from "@/components/Badge";
import { caseStatusLabel, formatDuration, scenarioRunStatusView } from "@/features/runs/labels";
import { scenarioStatusView } from "@/features/scenarios/labels";

export type CaseFilter = "all" | "failed" | "passed";

const isProblem = (c: ReportCaseItem) => c.status === "FAILED" || c.status === "ERROR";

interface Props {
  report: RunReport;
  selectedId: string | null;
  onSelect: (caseResultId: string) => void;
}

/** UI-04 좌측: 시나리오별 결과, 실행하지 않은 시나리오 안내, 이전 실행 대비 */
export function ScenarioResults({ report, selectedId, onSelect }: Props) {
  const [filter, setFilter] = useState<CaseFilter>("all");
  const cases = report.scenarios.flatMap((s) => s.cases);
  const counts = { all: cases.length, failed: cases.filter(isProblem).length, passed: cases.filter((c) => c.status === "PASSED").length };
  // 실패가 있는 시나리오를 먼저 보인다
  const scenarios = [...report.scenarios].sort((a, b) => Number(b.cases.some(isProblem)) - Number(a.cases.some(isProblem)));
  const visible = scenarios.filter((s) =>
    filter === "all" ? true : filter === "failed" ? s.cases.some(isProblem) : s.cases.some((c) => c.status === "PASSED"),
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-baseline justify-between">
        <h2 className="text-[15px] font-bold">시나리오별 결과</h2>
        <span className="text-xs text-muted">
          선택 {report.scenarios.length}개 · 케이스 {cases.length}개
        </span>
      </div>
      <div role="tablist" aria-label="케이스 필터" className="grid grid-cols-3 rounded-xl bg-field p-1">
        {(
          [
            ["all", "전체"],
            ["failed", "실패"],
            ["passed", "통과"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={filter === key}
            onClick={() => setFilter(key)}
            className={clsx("h-9 rounded-lg text-[13px]", filter === key ? "bg-surface font-semibold shadow-sm" : "text-ink/70 hover:text-ink")}
          >
            {label} {counts[key]}
          </button>
        ))}
      </div>

      <ul aria-label="시나리오 결과" className="overflow-hidden rounded-card border border-line bg-surface">
        {visible.length === 0 && <li className="px-4 py-8 text-center text-xs text-muted">해당하는 케이스가 없습니다</li>}
        {visible.map((scenario) => (
          <ScenarioItem key={scenario.scenarioRunId} scenario={scenario} filter={filter} selectedId={selectedId} onSelect={onSelect} />
        ))}
      </ul>

      {report.skippedScenarios.length > 0 && (
        <p className="flex items-start gap-1.5 text-xs text-muted">
          <Info aria-hidden className="mt-px size-3.5 shrink-0" />
          {report.skippedScenarios.map((s) => `${s.code}(${scenarioStatusView[s.status].label})`).join("와 ")}
          {report.skippedScenarios.length > 1 ? "는" : "은"} 선택되지 않아 실행하지 않았어요.
        </p>
      )}

      <Comparison report={report} />
    </div>
  );
}

function ScenarioItem({
  scenario,
  filter,
  selectedId,
  onSelect,
}: {
  scenario: ReportScenario;
  filter: CaseFilter;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const problems = scenario.cases.filter(isProblem);
  const passed = scenario.cases.filter((c) => c.status === "PASSED");
  const others = scenario.cases.filter((c) => !isProblem(c) && c.status !== "PASSED");
  const [open, setOpen] = useState(problems.length > 0);
  const [showPassed, setShowPassed] = useState(filter === "passed");
  const view = scenarioRunStatusView[scenario.status];
  const shownPassed = filter === "passed" || showPassed;

  return (
    <li data-testid={`report-scenario-${scenario.code}`} className="border-b border-line last:border-b-0">
      <button type="button" aria-expanded={open} onClick={() => setOpen((v) => !v)} className="flex w-full items-center gap-3 px-4 py-3.5 text-left hover:bg-page">
        {open ? <ChevronDown aria-hidden className="size-4 shrink-0 text-muted" /> : <ChevronRight aria-hidden className="size-4 shrink-0 text-muted" />}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold">{scenario.title}</span>
          <span className="mt-0.5 block font-mono text-xs text-muted">
            {[scenario.code, scenario.requirementRef, formatDuration(scenario.durationMs)].filter(Boolean).join(" · ")}
          </span>
        </span>
        <span className="flex shrink-0 flex-col items-end gap-1">
          <Badge tone={view.tone} icon={scenario.status === "PASSED" ? <CircleCheck aria-hidden className="size-3" /> : scenario.status === "FAILED" ? <CircleX aria-hidden className="size-3" /> : undefined}>
            {view.label}
          </Badge>
          <span className="font-mono text-xs text-ink/70">
            {scenario.passedCases} / {scenario.totalCases}
          </span>
        </span>
      </button>
      {open && (
        <div className="border-t border-line">
          {filter !== "passed" &&
            [...problems, ...others].map((c) => <CaseRow key={c.caseResultId} item={c} selected={selectedId === c.caseResultId} onSelect={onSelect} />)}
          {passed.length > 0 && filter !== "failed" && (
            <>
              {filter === "all" && (
                <button
                  type="button"
                  aria-expanded={showPassed}
                  onClick={() => setShowPassed((v) => !v)}
                  className="flex w-full items-center gap-2 border-t border-line px-4 py-2.5 pl-12 text-left text-xs text-ink/70 hover:bg-page"
                >
                  <CircleCheck aria-hidden className="size-3.5 text-success" />
                  통과한 케이스 {passed.length}개 {showPassed ? "접기" : "보기"}
                  <ChevronDown aria-hidden className={clsx("ml-auto size-4 text-muted", showPassed && "rotate-180")} />
                </button>
              )}
              {shownPassed && passed.map((c) => <CaseRow key={c.caseResultId} item={c} selected={selectedId === c.caseResultId} onSelect={onSelect} />)}
            </>
          )}
        </div>
      )}
    </li>
  );
}

function CaseRow({ item, selected, onSelect }: { item: ReportCaseItem; selected: boolean; onSelect: (id: string) => void }) {
  const failed = item.status === "FAILED";
  const error = item.status === "ERROR";
  const Icon = failed ? CircleX : error ? CircleAlert : CircleCheck;
  return (
    <button
      type="button"
      aria-current={selected || undefined}
      onClick={() => onSelect(item.caseResultId)}
      className={clsx(
        "flex w-full items-center gap-3 border-t border-line px-4 py-3 pl-12 text-left first:border-t-0 hover:bg-accent-row",
        selected && "border-l-2 border-l-accent bg-accent-soft/60",
      )}
    >
      <Icon aria-hidden className={clsx("size-4 shrink-0", failed ? "text-danger" : error ? "text-warning" : "text-success")} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-semibold">{item.title}</span>
        <span className={clsx("mt-0.5 block font-mono text-xs", failed ? "text-danger" : error ? "text-warning" : "text-muted")}>
          {item.code} · {caseStatusLabel[item.status]}
          {item.attempts > 1 && ` · ${item.attempts}회 실행`}
          {item.durationMs != null && ` · ${formatDuration(item.durationMs)}`}
        </span>
      </span>
      <ChevronRight aria-hidden className="size-4 shrink-0 text-muted" />
    </button>
  );
}

function Comparison({ report }: { report: RunReport }) {
  const c = report.comparison;
  const rows = [
    { label: "새로운 실패", icon: CircleAlert, iconClass: "text-danger", codes: c.newFailures },
    { label: "계속 실패", icon: ArrowRightLeft, iconClass: "text-warning", codes: c.continuingFailures },
    { label: "해결됨", icon: CircleCheck, iconClass: "text-success", codes: c.resolved },
  ];
  return (
    <section aria-labelledby="compare-title">
      <div className="flex items-baseline justify-between border-b border-line pb-2">
        <h2 id="compare-title" className="text-[13px] font-bold">
          이전 실행 대비
        </h2>
        <span className="font-mono text-xs text-muted">{c.previousRunCode ?? "비교 대상 없음"}</span>
      </div>
      {!c.previousRunCode ? (
        <p className="py-4 text-xs text-muted">같은 요청으로 끝난 이전 실행이 없어 비교하지 않았어요.</p>
      ) : (
        <ul className="divide-y divide-line">
          {rows.map((row) => (
            <li key={row.label} className="flex items-center gap-2.5 py-3 text-[13px]">
              <row.icon aria-hidden className={clsx("size-4", row.iconClass)} />
              <span className="flex-1">{row.label}</span>
              <span className="font-mono text-xs text-muted">{row.codes.join(", ")}</span>
              <span className="w-6 text-right font-mono font-semibold">{row.codes.length}</span>
            </li>
          ))}
          <li className="flex items-center gap-2.5 py-3 text-[13px]">
            <Percent aria-hidden className="size-4 text-accent" />
            <span className="flex-1">케이스 통과율</span>
            <span className="font-mono text-xs text-muted">이전 {c.previousCasePassRatePct ?? "-"}%</span>
            <span className="font-mono font-semibold">{report.kpis.casePassRatePct}%</span>
          </li>
        </ul>
      )}
    </section>
  );
}
