// UI-03을 실제 백엔드에 붙여 확인한다 (npm run test:integration). 로컬에는 Chromium이 없어 실행은 ERROR로 끝날 수 있다.
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { fetchEventSources } from "@/test/fetchEventSource";
import { renderRoute } from "@/test/render";

const BASE = process.env.INTEGRATION_BASE_URL ?? "http://localhost:5173";
const PROJECT_ID = process.env.INTEGRATION_PROJECT_ID ?? "00000000-0000-0000-0000-0000000000a1";
const LONG = { timeout: 170_000 };

describe("M3 실제 백엔드 연동", () => {
  it("승인 → 테스트 실행 → UI-03 실시간 갱신 → 끝 상태에서 연결 종료", async () => {
    const sse = fetchEventSources(BASE);
    const user = userEvent.setup();
    const { router } = renderRoute(`/projects/${PROJECT_ID}/scenarios`, { eventSource: sse.factory });
    await screen.findByRole("heading", { name: /생성된 시나리오/ }, LONG);

    // 검토 필요 시나리오 하나를 승인하고, 승인된 시나리오 하나를 체크한다
    const rows = screen.getAllByTestId(/^scenario-SC-/);
    let target = rows.find((r) => within(r).queryByRole("checkbox", { checked: false }) && !within(r).getByRole("checkbox").hasAttribute("disabled"));
    if (!target) {
      const review = rows.find((r) => within(r).queryByText("검토 필요"));
      expect(review, "승인할 수 있는 시나리오가 있어야 한다").toBeDefined();
      const code = review!.dataset.testid!.replace("scenario-", "");
      await user.click(within(review!).getByRole("button", { name: `${code} 펼치기` }));
      await user.click(within(review!).getByRole("button", { name: "승인" }));
      await waitFor(() => expect(within(screen.getByTestId(`scenario-${code}`)).getByRole("checkbox")).toBeEnabled(), LONG);
      target = screen.getByTestId(`scenario-${code}`);
    }
    await user.click(within(target).getByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: /^테스트 실행 \(1\)$/ }));

    await waitFor(() => expect(router.state.location.pathname).toMatch(/\/runs\/[^/]+\/monitor$/), LONG);
    await screen.findByRole("heading", { name: /테스트 실행|실행 준비/ }, LONG);
    await waitFor(() => expect(sse.sources.length).toBeGreaterThan(0), LONG);
    expect(screen.getByLabelText("진행 현황")).toHaveTextContent("0 / 1");

    // 끝 상태가 오면 연결을 닫는다
    await waitFor(() => expect(screen.getByText("종료")).toBeInTheDocument(), LONG);
    const types = sse.sources[0]!.received.map((e) => e.type);
    expect(types).toContain("run.status");
    const ids = sse.sources[0]!.received.filter((e) => e.type !== "heartbeat").map((e) => Number(e.id));
    expect(ids).toEqual([...ids].sort((a, b) => a - b)); // seq 순서
    expect(screen.getByLabelText("진행 현황")).toHaveTextContent("1 / 1");
    const heading = screen.getByRole("heading", { level: 1 }).textContent ?? "";
    expect(heading).toMatch(/완료|오류|중단됨/);
    if (/오류/.test(heading)) expect(screen.getByRole("alert")).toBeInTheDocument(); // errorMessage
    const logs = within(screen.getByTestId("log-lines")).queryAllByText(/./);
    expect(logs.length).toBeGreaterThan(0);
    process.stdout.write(`[M3] ${heading} · 이벤트 ${types.length}개 (${[...new Set(types)].join(",")})\n`);
  });

  it("사이드바 실행 모니터는 최근 실행을 열고, 끝난 실행은 SSE를 열지 않는다", async () => {
    const sse = fetchEventSources(BASE);
    const { router } = renderRoute(`/projects/${PROJECT_ID}/monitor`, { eventSource: sse.factory });
    await waitFor(() => expect(router.state.location.pathname).toMatch(/\/runs\/[^/]+\/monitor$/), LONG);
    await screen.findByLabelText("진행 현황", undefined, LONG);
    expect(screen.getByText("종료")).toBeInTheDocument();
    expect(sse.sources).toHaveLength(0);
  });
});
