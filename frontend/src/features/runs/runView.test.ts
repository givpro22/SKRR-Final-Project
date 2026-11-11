import { describe, expect, it } from "vitest";
import type { RunDetail } from "@/api/types";
import { progressOf, specCaseOf, stripAnsi } from "./runView";

const sr = (code: string, status: RunDetail["scenarioRuns"][number]["status"], order: number, caseStatus: "PENDING" | "RUNNING" | "FAILED" = "PENDING") => ({
  id: code,
  scenarioId: code,
  code,
  title: code,
  order,
  status,
  cases: [{ id: `${code}-c`, testCaseId: "t", code: `TC-0${order}`, title: "케이스", status: caseStatus, attempts: 1, failedAttempts: 0, steps: [] }],
});

const run = (scenarioRuns: RunDetail["scenarioRuns"], progress?: Partial<RunDetail["progress"]>): RunDetail => ({
  id: "r",
  code: "RUN-0001",
  projectId: "p",
  testRequestId: "t",
  status: "RUNNING",
  targetUrl: "http://t",
  browser: "Chromium",
  viewportWidth: 1280,
  viewportHeight: 800,
  documentVersions: {},
  createdAt: "2026-11-10T00:00:00Z",
  progress: { totalScenarios: 3, finishedScenarios: 0, passed: 0, failed: 0, error: 0, skipped: 0, cancelled: 0, running: 0, waiting: 3, ...progress },
  scenarioRuns,
  lastEventSeq: 0,
});

describe("progressOf", () => {
  it("run.status가 오지 않아도 시나리오 상태로 진행을 센다", () => {
    const p = progressOf(run([sr("SC-01", "FAILED", 1), sr("SC-02", "RUNNING", 2), sr("SC-03", "WAITING", 3)]));
    expect(p).toMatchObject({ totalScenarios: 3, finishedScenarios: 1, failed: 1, running: 1, waiting: 1 });
  });

  it("서버 집계가 더 앞서 있으면 서버 값을 쓴다", () => {
    const p = progressOf(run([sr("SC-01", "WAITING", 1)], { totalScenarios: 1, finishedScenarios: 1, failed: 1, waiting: 0 }));
    expect(p.finishedScenarios).toBe(1);
  });
});

describe("specCaseOf", () => {
  it("실행 중 케이스, 끝나면 마지막으로 돈 케이스", () => {
    expect(specCaseOf(run([sr("SC-01", "PASSED", 1, "FAILED"), sr("SC-02", "RUNNING", 2, "RUNNING")]))?.code).toBe("TC-02");
    expect(specCaseOf(run([sr("SC-01", "FAILED", 1, "FAILED"), sr("SC-02", "SKIPPED", 2)]))?.code).toBe("TC-01");
  });
});

describe("stripAnsi", () => {
  it("실행기 로그의 터미널 색 코드를 지운다", () => {
    expect(stripAnsi("Call log:\n  \u001b[2m- waiting for getByTestId('x')\u001b[22m")).toBe("Call log:\n  - waiting for getByTestId('x')");
  });
});
