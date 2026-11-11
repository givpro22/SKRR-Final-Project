import clsx from "clsx";
import { Check, CircleAlert, CircleCheck, CircleDashed, CircleMinus, CircleX, Dot, Loader, X, type LucideIcon } from "lucide-react";
import type { CaseRunSummary, RunStep, ScenarioRun, ScenarioRunStatus, StepStatus } from "@/api/types";
import { Badge } from "@/components/Badge";
import { CodeText } from "@/components/CodeText";
import { caseStatusLabel, formatDuration, scenarioRunStatusView } from "./labels";
import { focusCase } from "./runView";

const statusIcon: Record<ScenarioRunStatus, { icon: LucideIcon; className: string }> = {
  PASSED: { icon: CircleCheck, className: "text-success" },
  FAILED: { icon: CircleX, className: "text-danger" },
  ERROR: { icon: CircleAlert, className: "text-warning" },
  RUNNING: { icon: Loader, className: "animate-spin text-accent" },
  WAITING: { icon: CircleDashed, className: "text-muted" },
  SKIPPED: { icon: CircleMinus, className: "text-muted" },
  CANCELLED: { icon: CircleMinus, className: "text-muted" },
};

const statusText: Record<ScenarioRunStatus, string> = {
  PASSED: "text-muted",
  FAILED: "text-danger",
  ERROR: "text-warning",
  RUNNING: "text-accent",
  WAITING: "text-muted",
  SKIPPED: "text-muted",
  CANCELLED: "text-muted",
};


const stepDone: StepStatus[] = ["PASSED", "FAILED", "SKIPPED"];

export function ScenarioCards({ scenarioRuns }: { scenarioRuns: ScenarioRun[] }) {
  const ordered = [...scenarioRuns].sort((a, b) => a.order - b.order);
  return (
    <ul aria-label="시나리오 진행" className="overflow-hidden rounded-card border border-line bg-surface">
      {ordered.map((scenario) => {
        const view = scenarioRunStatusView[scenario.status];
        const { icon: Icon, className } = statusIcon[scenario.status];
        const running = scenario.status === "RUNNING";
        const focus = running ? focusCase(scenario) : undefined;
        const steps = focus?.steps ?? [];
        const done = steps.filter((s) => stepDone.includes(s.status)).length;
        return (
          <li
            key={scenario.id}
            data-testid={`run-scenario-${scenario.code}`}
            className={clsx("flex gap-3 border-b border-line px-4 py-4 last:border-b-0", running && "bg-accent-row")}
          >
            <Icon aria-hidden className={clsx("mt-0.5 size-[18px] shrink-0", className)} strokeWidth={1.75} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">{scenario.title}</p>
              <p className={clsx("mt-1 font-mono text-xs", statusText[scenario.status])}>
                <span className={running ? "text-accent" : "text-muted"}>{scenario.code}</span>
                <span className="mx-2 text-muted">·</span>
                {view.label}
                {running && steps.length > 0 && (
                  <>
                    <span className="mx-2">·</span>
                    {done}/{steps.length} 단계
                  </>
                )}
                {!running && scenario.durationMs != null && (
                  <>
                    <span className="mx-2 text-muted">·</span>
                    <span className="text-ink/70">{formatDuration(scenario.durationMs)}</span>
                  </>
                )}
              </p>
              {running && focus && <CaseSteps scenario={scenario} focus={focus} />}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function CaseSteps({ scenario, focus }: { scenario: ScenarioRun; focus: CaseRunSummary }) {
  const steps = [...(focus.steps ?? [])].sort((a, b) => a.order - b.order);
  return (
    <div className="mt-2">
      {(scenario.cases.length > 1 || focus.attempts > 1) && (
        <p className="mb-1 flex items-center gap-2 text-[11px] text-muted">
          <span className="font-mono">{focus.code}</span>
          {focus.title}
          {focus.attempts > 1 && (
            <Badge tone="warning" className="h-5 px-2">
              재현 {focus.attempts}회차
            </Badge>
          )}
          <span className="ml-auto">{caseStatusLabel[focus.status]}</span>
        </p>
      )}
      <ol aria-label={`${focus.code} 단계`} className="flex flex-col gap-1.5">
        {steps.map((step) => (
          <StepItem key={step.id} step={step} />
        ))}
      </ol>
    </div>
  );
}

const stepIcon: Record<StepStatus, { icon: LucideIcon; className: string }> = {
  PASSED: { icon: Check, className: "text-success" },
  RUNNING: { icon: Loader, className: "animate-spin text-accent" },
  PENDING: { icon: Dot, className: "text-muted" },
  FAILED: { icon: X, className: "text-danger" },
  SKIPPED: { icon: CircleMinus, className: "text-muted" },
};

function StepItem({ step }: { step: RunStep }) {
  const { icon: Icon, className } = stepIcon[step.status];
  return (
    <li data-status={step.status} className={clsx("flex items-start gap-2 text-[13px]", step.status === "PENDING" ? "text-ink/60" : "text-ink/85", step.status === "RUNNING" && "font-semibold")}>
      <Icon aria-hidden className={clsx("mt-0.5 size-3.5 shrink-0", className)} strokeWidth={2} />
      <span className="min-w-0">
        <CodeText text={step.title} /> <span className="text-muted">({step.kind})</span>
        {step.status === "FAILED" && (step.expectedValue || step.actualValue) && (
          <span className="block text-xs text-danger">
            예상 {step.expectedValue ?? "-"} · 실제 {step.actualValue ?? "-"}
          </span>
        )}
      </span>
    </li>
  );
}
