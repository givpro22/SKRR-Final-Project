import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { MOCK_PROJECT_ID } from "@/mocks/db";
import { ensureSeed } from "@/mocks/reportDb";
import { rdb } from "@/mocks/runDb";
import { server } from "@/mocks/server";
import { fakeEventSources } from "@/test/fakeEventSource";
import { renderRoute } from "@/test/render";

function seededRun(code: "RUN-0316" | "RUN-0317") {
  ensureSeed();
  return rdb.runs.find((r) => r.initial.code === code)!.initial;
}

async function renderReport(code: "RUN-0316" | "RUN-0317" = "RUN-0317") {
  const run = seededRun(code);
  const utils = renderRoute(`/projects/${MOCK_PROJECT_ID}/runs/${run.id}/report`, { eventSource: fakeEventSources().factory });
  await screen.findByRole("heading", { name: "테스트 결과 리포트" });
  return { run, ...utils };
}

describe("UI-04 결과 리포트", () => {
  it("헤더·메타·지표를 보여 주고 PDF 버튼은 두지 않는다 (ADR-013)", async () => {
    await renderReport();
    expect(screen.getByText(/RUN-0317 · /)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "실패 1건 재실행" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: /PDF/ })).not.toBeInTheDocument();
    expect(screen.getByText("shop-mock.skrr.dev · 빌드 a3f9c21")).toBeInTheDocument();
    expect(screen.getByText("Chromium 130 · 1280×800")).toBeInTheDocument();
    expect(screen.getByText("요구사항 v3 · API v2 · 카탈로그 v2")).toBeInTheDocument();
    const kpis = screen.getByRole("list", { name: "결과 지표" });
    expect(within(kpis).getByText("3 / 4")).toBeInTheDocument();
    expect(within(kpis).getByText("17 / 18")).toBeInTheDocument();
    expect(within(kpis).getByText("통과율 94%")).toBeInTheDocument();
    expect(within(kpis).getByText("SC-02")).toBeInTheDocument();
  });

  it("실패 시나리오를 먼저 펼치고 통과 케이스는 접어 둔다", async () => {
    const user = userEvent.setup();
    await renderReport();
    const items = screen.getByRole("list", { name: "시나리오 결과" });
    const first = within(items).getAllByRole("listitem")[0]!;
    expect(first).toHaveAttribute("data-testid", "report-scenario-SC-02");
    expect(within(first).getByRole("button", { name: /TC-07 · 실패/ })).toBeInTheDocument();
    const toggle = within(first).getByRole("button", { name: /통과한 케이스 3개 보기/ });
    await user.click(toggle);
    expect(within(first).getByRole("button", { name: /TC-08/ })).toBeInTheDocument();
    // 실패 탭
    await user.click(screen.getByRole("tab", { name: "실패 1" }));
    expect(within(items).getAllByRole("listitem")).toHaveLength(1);
    expect(screen.getByText(/SC-05\(검토 필요\)와 SC-06\(가드 재생성\)는 선택되지 않아 실행하지 않았어요/)).toBeInTheDocument();
  });

  it("실패 케이스 상세: 사실, 교차 검증, 재현 단계, 분석 중 → 원인 후보, 실행 증거", async () => {
    await renderReport();
    const detail = await screen.findByTestId("case-detail");
    expect(detail).toHaveTextContent("TC-07");
    const panel = screen.getByRole("region", { name: "케이스 상세" });
    expect(within(panel).getByText("실패 1 / 1")).toBeInTheDocument();
    expect(within(panel).getByText("데이터 불일치")).toBeInTheDocument();
    expect(within(panel).getByText("2회 중 2회")).toBeInTheDocument();
    expect(within(panel).getByText("이번 실행")).toBeInTheDocument();
    // 교차 검증: DB 값에 경고, 판정 불일치
    expect(within(panel).getByLabelText("불일치 값")).toBeInTheDocument();
    expect(within(panel).getAllByText("불일치").length).toBeGreaterThan(0);
    // 재현 단계: 실패 단계의 예상·실제
    expect(within(panel).getByText("예상 qty 3 · 실제 qty 2")).toBeInTheDocument();
    // 분석 중(첫 조회) → 2초 조회로 완료
    expect(within(panel).getByRole("status")).toHaveTextContent("분석 중");
    expect(await within(panel).findByText("82%", undefined, { timeout: 3000 })).toBeInTheDocument();
    expect(within(panel).getByText(/해결 방안/)).toBeInTheDocument();
    expect(within(panel).getByText("높음")).toBeInTheDocument();
    expect(within(panel).getByText("장바구니 · 결제")).toBeInTheDocument();
    // 증거
    expect(within(panel).getByRole("button", { name: "실패 스크린샷" })).toBeInTheDocument();
    expect(within(panel).getByRole("button", { name: "Playwright trace" })).toBeInTheDocument();
    expect(within(panel).getByRole("button", { name: "HAR" })).toBeInTheDocument();
    expect(within(panel).getByRole("button", { name: "tc-07.spec.ts" })).toBeInTheDocument();
  });

  it("실패 스크린샷은 링크로 받아 미리 보기로 연다", async () => {
    const user = userEvent.setup();
    await renderReport();
    const panel = await screen.findByRole("region", { name: "케이스 상세" });
    await user.click(await within(panel).findByRole("button", { name: "실패 스크린샷" }));
    expect(await screen.findByRole("img", { name: "TC-07 실패 스크린샷" })).toHaveAttribute("src", expect.stringContaining("data:image/svg+xml"));
  });

  it("이전 실행 대비: 새 실패, 해결됨, 통과율", async () => {
    await renderReport();
    const section = screen.getByRole("heading", { name: "이전 실행 대비" }).closest("section")!;
    expect(within(section).getByText("RUN-0316")).toBeInTheDocument();
    expect(within(section).getByText("새로운 실패").closest("li")).toHaveTextContent("TC-071");
    expect(within(section).getByText("해결됨").closest("li")).toHaveTextContent("TC-011");
    expect(within(section).getByText("이전 94%")).toBeInTheDocument();
  });

  it("비교할 이전 실행이 없으면 안내한다", async () => {
    await renderReport("RUN-0316");
    expect(screen.getByText("같은 요청으로 끝난 이전 실행이 없어 비교하지 않았어요.")).toBeInTheDocument();
  });

  it("통과 케이스를 고르면 원인 영역 없이 보이고 실패 탐색은 숨긴다", async () => {
    const user = userEvent.setup();
    await renderReport();
    const items = screen.getByRole("list", { name: "시나리오 결과" });
    const sc1 = within(items).getByTestId("report-scenario-SC-01");
    await user.click(within(sc1).getAllByRole("button")[0]!);
    await user.click(within(sc1).getByRole("button", { name: /통과한 케이스 6개 보기/ }));
    await user.click(within(sc1).getByRole("button", { name: /TC-02/ }));
    const panel = await screen.findByRole("region", { name: "케이스 상세" });
    await within(panel).findByText(/TC-02/);
    expect(within(panel).queryByText(/원인 후보/)).not.toBeInTheDocument();
    expect(within(panel).queryByText(/실패 1 \/ 1/)).not.toBeInTheDocument();
  });

  it("실패 N건 재실행은 새 실행을 만들어 실행 모니터로 간다", async () => {
    const user = userEvent.setup();
    const { router, run } = await renderReport();
    await user.click(screen.getByRole("button", { name: "실패 1건 재실행" }));
    await waitFor(() => expect(router.state.location.pathname).toMatch(/\/runs\/[^/]+\/monitor$/));
    const created = rdb.runs[0]!.initial;
    expect(created.rerunOfRunId).toBe(run.id);
    expect(created.scenarioRuns.flatMap((s) => s.cases).map((c) => c.code)).toEqual(["TC-07"]);
  });

  it("이 케이스 재실행이 거부되면 사유를 알린다", async () => {
    server.use(
      http.post("*/api/v1/runs/:id/rerun", () =>
        HttpResponse.json(
          { status: 409, code: "RUN_ALREADY_ACTIVE", title: "실행 중" },
          { status: 409, headers: { "Content-Type": "application/problem+json" } },
        ),
      ),
    );
    const user = userEvent.setup();
    await renderReport();
    const panel = await screen.findByRole("region", { name: "케이스 상세" });
    await user.click(await within(panel).findByRole("button", { name: "이 케이스 재실행" }));
    expect(await screen.findByText("다른 실행이 진행 중이에요. 그 실행이 끝난 뒤 다시 시도해 주세요.")).toBeInTheDocument();
  });

  it("끝나지 않은 실행은 실행 모니터로 안내한다 (409 RUN_NOT_FINISHED)", async () => {
    ensureSeed();
    server.use(
      http.get("*/api/v1/runs/:id/report", () =>
        HttpResponse.json(
          { status: 409, code: "RUN_NOT_FINISHED", title: "실행 중" },
          { status: 409, headers: { "Content-Type": "application/problem+json" } },
        ),
      ),
    );
    renderRoute(`/projects/${MOCK_PROJECT_ID}/runs/x/report`);
    expect(await screen.findByText("아직 실행이 끝나지 않았어요")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "실행 모니터로 가기" })).toHaveAttribute("href", `/projects/${MOCK_PROJECT_ID}/runs/x/monitor`);
  });

  it("분석 실패와 실행 오류 케이스를 구분해 보인다", async () => {
    server.use(
      http.get("*/api/v1/case-results/:id", ({ params }) =>
        HttpResponse.json({
          id: String(params.id),
          code: "TC-07",
          title: "케이스",
          scenarioCode: "SC-02",
          scenarioTitle: "수량",
          status: "ERROR",
          attempts: 1,
          failedAttempts: 0,
          failureMessage: "실행기에 연결할 수 없습니다",
          analysisStatus: "FAILED",
          analysisError: "LLM 응답 시간 초과",
          affectedFeatures: [],
          verifications: [],
          reproductionSteps: [],
          rootCauses: [],
          artifacts: [],
        }),
      ),
    );
    await renderReport();
    const panel = await screen.findByRole("region", { name: "케이스 상세" });
    expect(await within(panel).findByText(/환경 문제로 판정하지 못한 케이스입니다/)).toBeInTheDocument();
    expect(within(panel).getByText("실행기에 연결할 수 없습니다")).toBeInTheDocument();
    expect(within(panel).getByText("분석 실패: LLM 응답 시간 초과")).toBeInTheDocument();
    expect(within(panel).getByText("저장된 스크린샷·trace·HAR가 없습니다")).toBeInTheDocument();
  });

  it("사이드바 리포트는 가장 최근에 끝난 실행을 연다", async () => {
    const run = seededRun("RUN-0317");
    const { router } = renderRoute(`/projects/${MOCK_PROJECT_ID}/report`);
    await waitFor(() => expect(router.state.location.pathname).toBe(`/projects/${MOCK_PROJECT_ID}/runs/${run.id}/report`));
    expect(await screen.findByRole("link", { name: "리포트" })).toHaveAttribute("aria-current", "page");
  });
});

describe("UI-03 → UI-04", () => {
  it("이 화면에서 실행이 끝나면 잠시 뒤 리포트로 이동한다", async () => {
    ensureSeed();
    const run = rdb.runs.find((r) => r.initial.code === "RUN-0317")!;
    // 끝난 실행 스냅샷을 진행 중으로 보이게 해 SSE로 끝 상태를 받게 한다
    run.done = false;
    rdb.frozen = true;
    const fake = fakeEventSources();
    const { router } = renderRoute(`/projects/${MOCK_PROJECT_ID}/runs/${run.initial.id}/monitor`, { eventSource: fake.factory });
    await screen.findByRole("heading", { name: "테스트 실행 준비 중" });
    run.done = true;
    fake.last()!.emit("run.status", { status: "FAILED", progress: { totalScenarios: 4, finishedScenarios: 4, passed: 3, failed: 1, error: 0, skipped: 0, cancelled: 0, running: 0, waiting: 0 } }, 9999);
    expect(await screen.findByText("실행이 끝났어요. 잠시 뒤 결과 리포트로 이동합니다.")).toBeInTheDocument();
    await waitFor(() => expect(router.state.location.pathname).toBe(`/projects/${MOCK_PROJECT_ID}/runs/${run.initial.id}/report`), { timeout: 4000 });
  });

  it("이미 끝난 실행을 열면 이동하지 않고 리포트 버튼을 보인다", async () => {
    ensureSeed();
    const run = rdb.runs.find((r) => r.initial.code === "RUN-0317")!.initial;
    renderRoute(`/projects/${MOCK_PROJECT_ID}/runs/${run.id}/monitor`, { eventSource: fakeEventSources().factory });
    expect(await screen.findByRole("link", { name: "결과 리포트 보기" })).toHaveAttribute("href", `/projects/${MOCK_PROJECT_ID}/runs/${run.id}/report`);
    expect(screen.queryByText(/잠시 뒤 결과 리포트로 이동/)).not.toBeInTheDocument();
  });
});
