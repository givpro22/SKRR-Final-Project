import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { MOCK_PROJECT_ID } from "@/mocks/db";
import { rdb } from "@/mocks/runDb";
import { MOCK_REQUEST_ID } from "@/mocks/scenarioDb";
import { server } from "@/mocks/server";
import { fakeEventSources } from "@/test/fakeEventSource";
import { renderRoute } from "@/test/render";

const SCENARIOS = `/projects/${MOCK_PROJECT_ID}/requests/${MOCK_REQUEST_ID}/scenarios`;
const progress = (p: Partial<Record<string, number>>) => ({
  totalScenarios: 2,
  finishedScenarios: 0,
  passed: 0,
  failed: 0,
  error: 0,
  skipped: 0,
  cancelled: 0,
  running: 0,
  waiting: 2,
  ...p,
});

/** UI-02-5에서 SC-01·SC-02를 체크하고 실행을 시작해 UI-03으로 간다 */
async function startRun() {
  const fake = fakeEventSources();
  const user = userEvent.setup();
  const utils = renderRoute(SCENARIOS, { eventSource: fake.factory });
  await screen.findByTestId("scenario-SC-01");
  await user.click(within(screen.getByTestId("scenario-SC-01")).getByRole("checkbox"));
  await user.click(within(screen.getByTestId("scenario-SC-02")).getByRole("checkbox"));
  await user.click(screen.getByRole("button", { name: "테스트 실행 (2)" }));
  await screen.findByRole("heading", { name: "테스트 실행 준비 중" });
  await waitFor(() => expect(fake.sources).toHaveLength(1));
  const run = rdb.runs[0]!.initial;
  return { user, fake, run, source: fake.last()!, ...utils };
}

describe("UI-02-5 테스트 실행", () => {
  it("승인 시나리오를 체크해야 실행할 수 있다", async () => {
    renderRoute(SCENARIOS);
    await screen.findByTestId("scenario-SC-01");
    expect(screen.getByRole("button", { name: "테스트 실행" })).toBeDisabled();
  });

  it("다른 실행이 진행 중이면 안내한다 (U3)", async () => {
    server.use(
      http.post("*/api/v1/test-requests/:id/runs", () =>
        HttpResponse.json(
          { status: 409, code: "RUN_ALREADY_ACTIVE", title: "실행 중" },
          { status: 409, headers: { "Content-Type": "application/problem+json" } },
        ),
      ),
    );
    const user = userEvent.setup();
    renderRoute(SCENARIOS);
    await screen.findByTestId("scenario-SC-01");
    await user.click(within(screen.getByTestId("scenario-SC-01")).getByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: "테스트 실행 (1)" }));
    expect(await screen.findByText("다른 실행이 진행 중이에요. 그 실행이 끝난 뒤 다시 시도해 주세요.")).toBeInTheDocument();
  });
});

describe("UI-03 실행 모니터", () => {
  it("스냅샷을 그린 뒤 lastEventSeq로 SSE를 연다", async () => {
    const { source, run } = await startRun();
    expect(source.url).toBe(`/api/v1/runs/${run.id}/events?afterSeq=0`);
    expect(screen.getByText(run.code)).toBeInTheDocument();
    expect(screen.getByLabelText("진행 현황")).toHaveTextContent("0 / 2");
    expect(within(screen.getByTestId("run-scenario-SC-01")).getByText("대기")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "실행 모니터" })).toHaveAttribute("aria-current", "page");
  });

  it("이벤트로 진행·단계·로그·API 호출·현재 화면을 갱신한다", async () => {
    const { source, run } = await startRun();
    const sc1 = run.scenarioRuns[0]!;
    const tc = sc1.cases[0]!;
    source.open();
    expect(screen.getByText("streaming")).toBeInTheDocument();
    source.emit("run.status", { status: "RUNNING", progress: progress({ running: 1, waiting: 1 }) }, 1);
    source.emit("scenario.status", { scenarioRunId: sc1.id, code: sc1.code, status: "RUNNING" }, 2);
    source.emit("case.status", { caseResultId: tc.id, code: tc.code, status: "RUNNING", attempt: 1, failedAttempts: 0 }, 3);
    const steps = ["SETUP", "UI", "API", "DB", "ASSERT", "TEARDOWN"];
    steps.forEach((kind, i) =>
      source.emit("step.status", { caseResultId: tc.id, stepId: `st-${i}`, order: i + 1, attempt: 1, kind, title: `단계${i + 1}`, status: "PENDING" }, 4 + i),
    );
    source.emit("step.status", { caseResultId: tc.id, stepId: "st-0", order: 1, attempt: 1, kind: "SETUP", title: "단계1", status: "PASSED" }, 10);
    source.emit("step.status", { caseResultId: tc.id, stepId: "st-1", order: 2, attempt: 1, kind: "UI", title: "단계2", status: "RUNNING" }, 11);
    source.emit("log", { kind: "UI", message: "goto /cart" }, 12);
    source.emit("api.call", { id: 1, method: "POST", path: "/orders", statusCode: 201, durationMs: 200 }, 13);
    source.emit("api.call", { id: 2, method: "GET", path: "/cart", statusCode: 200, durationMs: 100 }, 14);
    source.emit("verification", { caseResultId: tc.id, itemLabel: "주문 수량", uiValue: "3", apiValue: "3", dbValue: "2", verdict: "MISMATCH" }, 15);
    source.emit("log", { kind: "ASSERT", message: "✗ 주문 수량 → 불일치" }, 16);

    const card = screen.getByTestId("run-scenario-SC-01");
    expect(card).toHaveTextContent("실행 중");
    expect(card).toHaveTextContent("1/6 단계");
    expect(within(card).getByText("단계2").closest("li")).toHaveAttribute("data-status", "RUNNING");
    expect(screen.getByRole("heading", { name: "테스트 실행 중" })).toBeInTheDocument();
    expect(screen.getByText(/^LIVE · \d{2}:\d{2}$/)).toBeInTheDocument();
    const logs = screen.getByTestId("log-lines");
    expect(within(logs).getByText("goto /cart")).toBeInTheDocument();
    // verification은 같은 내용의 log와 함께 오므로 한 줄만 보인다
    expect(within(logs).getAllByText(/주문 수량/)).toHaveLength(1);
    expect(screen.getByText("2건 · 평균 150ms")).toBeInTheDocument();
    expect(screen.getByText("/orders")).toBeInTheDocument();

    // 현재 화면: screenshot 이벤트 → getArtifactDownloadLink
    rdb.frozen = false;
    rdb.runs[0]!.startedAtMs = Date.now() - 60_000; // 목 대본의 스크린샷이 일어난 것으로 본다
    const shot = rdb.runs[0]!.script.find((e) => e.type === "screenshot")!;
    source.emit("screenshot", { artifactId: shot.data.artifactId, caseResultId: tc.id, stepId: "st-1", path: "/cart" }, 17);
    expect(await screen.findByRole("img", { name: "현재 화면 /cart" })).toHaveAttribute("src", expect.stringContaining("data:image/svg+xml"));
  });

  it("재연결로 같은 이벤트가 다시 와도 한 번만 그린다", async () => {
    const { source } = await startRun();
    source.emit("log", { kind: "API", message: "POST /orders 201" }, 5);
    source.fail(0);
    expect(screen.getByText("재연결 중")).toBeInTheDocument();
    source.open();
    source.emit("log", { kind: "API", message: "POST /orders 201" }, 5);
    expect(within(screen.getByTestId("log-lines")).getAllByText("POST /orders 201")).toHaveLength(1);
  });

  it("연결이 닫히면 알리고 다시 연결하면 스냅샷부터 새로 연다", async () => {
    const { source, fake, user } = await startRun();
    source.fail(2);
    await user.click(await screen.findByRole("button", { name: "다시 연결" }));
    await waitFor(() => expect(fake.sources).toHaveLength(2));
  });

  it("끝난 상태를 받으면 연결을 닫고 완료로 바꾼다", async () => {
    const { source } = await startRun();
    source.open();
    source.emit("run.status", { status: "FAILED", progress: progress({ finishedScenarios: 2, passed: 1, failed: 1, waiting: 0 }) }, 1);
    expect(source.closed).toBe(true);
    expect(screen.getByRole("heading", { name: "테스트 실행 완료 · 실패 있음" })).toBeInTheDocument();
    expect(screen.getByText("종료")).toBeInTheDocument();
    expect(screen.getByLabelText("진행 현황")).toHaveTextContent("2 / 2");
    expect(screen.queryByRole("button", { name: "실행 중단" })).not.toBeInTheDocument();
  });

  it("끝나면 스냅샷을 한 번 더 읽어 이벤트에 없던 값(시간 등)을 채운다", async () => {
    const { source, run } = await startRun();
    let snapshots = 0;
    server.events.on("request:start", ({ request }) => {
      if (request.method === "GET" && new URL(request.url).pathname === `/api/v1/runs/${run.id}`) snapshots += 1;
    });
    source.emit("run.status", { status: "PASSED", progress: progress({ finishedScenarios: 2, passed: 2, waiting: 0 }) }, 1);
    await waitFor(() => expect(snapshots).toBe(1), { timeout: 3000 });
    server.events.removeAllListeners();
  });

  it("범례에 실행 오류·건너뜀·중단됨을 넣어 합이 전체와 같다 (Q-M3-9)", async () => {
    const sr = (code: string, status: string, order: number) => ({ id: code, scenarioId: code, code, title: code, order, status, cases: [] });
    const snapshotWith = (scenarioRuns: unknown[], progress: Record<string, number>, status: string) =>
      http.get("*/api/v1/runs/:id", () =>
        HttpResponse.json({
          id: "r",
          code: "RUN-0010",
          projectId: MOCK_PROJECT_ID,
          testRequestId: "t",
          status,
          targetUrl: "http://x",
          browser: "Chromium",
          viewportWidth: 1280,
          viewportHeight: 800,
          documentVersions: {},
          createdAt: "2026-11-10T00:00:00Z",
          progress: { totalScenarios: 3, finishedScenarios: 3, passed: 0, failed: 0, error: 0, skipped: 0, cancelled: 0, running: 0, waiting: 0, ...progress },
          scenarioRuns,
          lastEventSeq: 5,
        }),
      );
    const sumOf = (text: string) => [...text.matchAll(/(\d+)/g)].reduce((a, m) => a + Number(m[1]), 0);

    // 대상 사이트가 꺼진 실행: 오류 1, 건너뜀 2 (스냅샷 시나리오 상태가 늦어도 서버 집계로 보인다)
    server.use(snapshotWith([sr("SC-01", "ERROR", 1), sr("SC-02", "WAITING", 2), sr("SC-03", "WAITING", 3)], { error: 1, skipped: 2 }, "ERROR"));
    const first = renderRoute(`/projects/${MOCK_PROJECT_ID}/runs/r/monitor`, { eventSource: fakeEventSources().factory });
    let legend = await screen.findByRole("list", { name: "진행 범례" });
    expect(legend).toHaveTextContent("실행 오류 1");
    expect(legend).toHaveTextContent("건너뜀 2");
    expect(sumOf(legend.textContent ?? "")).toBe(3);
    first.unmount();

    // 중단한 실행
    server.use(snapshotWith([sr("SC-01", "PASSED", 1), sr("SC-02", "CANCELLED", 2), sr("SC-03", "CANCELLED", 3)], { passed: 1, cancelled: 2 }, "CANCELLED"));
    renderRoute(`/projects/${MOCK_PROJECT_ID}/runs/r/monitor`, { eventSource: fakeEventSources().factory });
    legend = await screen.findByRole("list", { name: "진행 범례" });
    expect(legend).toHaveTextContent("중단됨 2");
    expect(sumOf(legend.textContent ?? "")).toBe(3);
  });

  it("로그는 최근 1000줄만 그린다", async () => {
    const { source } = await startRun();
    for (let i = 1; i <= 1005; i += 1) source.emit("log", { kind: "UI", message: `줄 ${i}` }, i);
    const logs = screen.getByTestId("log-lines");
    expect(within(logs).queryByText("줄 5")).not.toBeInTheDocument();
    expect(within(logs).getByText("줄 6")).toBeInTheDocument();
    expect(within(logs).getByText("줄 1005")).toBeInTheDocument();
  });

  it("실행 중단은 확인 후 요청하고 멈추는 중으로 바꾼다", async () => {
    const { user } = await startRun();
    await user.click(screen.getByRole("button", { name: "실행 중단" }));
    const dialog = await screen.findByRole("dialog", { name: "실행을 멈출까요?" });
    await user.click(within(dialog).getByRole("button", { name: "실행 중단" }));
    expect(await screen.findByRole("heading", { name: "실행을 멈추는 중" })).toBeInTheDocument();
  });

  it("spec 코드 보기는 실행 중인 케이스의 spec 탭을 열고, 준비 전이면 안내한다 (U4)", async () => {
    const { source, run, user } = await startRun();
    const sc1 = run.scenarioRuns[0]!;
    const tc = sc1.cases[0]!;
    source.emit("scenario.status", { scenarioRunId: sc1.id, code: sc1.code, status: "RUNNING" }, 1);
    source.emit("case.status", { caseResultId: tc.id, code: tc.code, status: "RUNNING", attempt: 1, failedAttempts: 0 }, 2);
    await user.click(screen.getByRole("button", { name: "spec 코드 보기" }));
    expect(screen.getByRole("tab", { name: "tc-01.spec.ts" })).toHaveAttribute("aria-selected", "true");
    // 목 스냅샷은 PREPARING이라 spec이 아직 없다 (404)
    expect(await screen.findByText("tc-01.spec.ts을 아직 만들고 있습니다 (준비 중)")).toBeInTheDocument();
  });

  it("없는 실행은 오류를 보여 준다", async () => {
    renderRoute(`/projects/${MOCK_PROJECT_ID}/runs/00000000-0000-4000-8000-000000000000/monitor`);
    expect(await screen.findByText("요청한 대상을 찾을 수 없습니다.")).toBeInTheDocument();
  });

  it("사이드바 실행 모니터는 진행 중인 실행을 연다", async () => {
    const { run } = await startRun();
    const { router } = renderRoute(`/projects/${MOCK_PROJECT_ID}/monitor`, { eventSource: fakeEventSources().factory });
    await waitFor(() => expect(router.state.location.pathname).toBe(`/projects/${MOCK_PROJECT_ID}/runs/${run.id}/monitor`));
  });
});
