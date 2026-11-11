import { describe, expect, it } from "vitest";
import type { RunDetail } from "@/api/types";
import { applyRunEvent, parseRunEvent } from "./runEvents";

const base: RunDetail = {
  id: "r",
  code: "RUN-0001",
  projectId: "p",
  testRequestId: "t",
  status: "RUNNING",
  targetUrl: "https://shop.test",
  browser: "Chromium 130",
  viewportWidth: 1280,
  viewportHeight: 800,
  documentVersions: {},
  createdAt: "2026-11-10T00:00:00Z",
  progress: { totalScenarios: 1, finishedScenarios: 0, passed: 0, failed: 0, error: 0, skipped: 0, cancelled: 0, running: 1, waiting: 0 },
  scenarioRuns: [
    {
      id: "sr",
      scenarioId: "s",
      code: "SC-01",
      title: "담기",
      order: 1,
      status: "RUNNING",
      cases: [{ id: "c", testCaseId: "tc", code: "TC-01", title: "케이스", status: "RUNNING", attempts: 1, failedAttempts: 0, steps: [] }],
    },
  ],
  lastEventSeq: 0,
};

const step = (attempt: number, order: number, status: string) =>
  parseRunEvent(
    "step.status",
    JSON.stringify({ caseResultId: "c", stepId: `s${attempt}-${order}`, order, attempt, kind: "UI", title: `단계 ${order}`, status }),
  )!;

describe("applyRunEvent", () => {
  it("단계를 추가·갱신하고 순서대로 둔다", () => {
    let run = applyRunEvent(base, step(1, 2, "PENDING"));
    run = applyRunEvent(run, step(1, 1, "RUNNING"));
    run = applyRunEvent(run, step(1, 1, "PASSED"));
    const steps = run.scenarioRuns[0]!.cases[0]!.steps!;
    expect(steps.map((s) => [s.order, s.status])).toEqual([
      [1, "PASSED"],
      [2, "PENDING"],
    ]);
  });

  it("새 재현 시도가 오면 단계 목록을 그 시도로 바꾸고, 지난 시도의 늦은 이벤트는 버린다", () => {
    let run = applyRunEvent(base, step(1, 1, "FAILED"));
    run = applyRunEvent(run, step(2, 1, "RUNNING"));
    run = applyRunEvent(run, step(1, 2, "PASSED"));
    const steps = run.scenarioRuns[0]!.cases[0]!.steps!;
    expect(steps.map((s) => [s.attempt, s.order, s.status])).toEqual([[2, 1, "RUNNING"]]);
  });

  it("케이스·시나리오·실행 상태와 진행 집계를 반영한다", () => {
    let run = applyRunEvent(base, parseRunEvent("case.status", JSON.stringify({ caseResultId: "c", status: "FAILED", attempt: 3, failedAttempts: 2 }))!);
    run = applyRunEvent(run, parseRunEvent("scenario.status", JSON.stringify({ scenarioRunId: "sr", status: "FAILED", durationMs: 9600 }))!);
    run = applyRunEvent(
      run,
      parseRunEvent(
        "run.status",
        JSON.stringify({ status: "FAILED", progress: { ...base.progress, finishedScenarios: 1, failed: 1, running: 0 } }),
      )!,
    );
    expect(run.scenarioRuns[0]!.cases[0]).toMatchObject({ status: "FAILED", attempts: 3, failedAttempts: 2 });
    expect(run.scenarioRuns[0]).toMatchObject({ status: "FAILED", durationMs: 9600 });
    expect(run.status).toBe("FAILED");
    expect(run.progress.failed).toBe(1);
  });

  it("계약에 없는 값은 받지 않는다", () => {
    expect(parseRunEvent("run.status", JSON.stringify({ status: "DONE" }))).toBeNull();
    expect(parseRunEvent("log", "not json")).toBeNull();
  });
});
