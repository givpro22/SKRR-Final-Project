import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { db, MOCK_PROJECT_ID } from "@/mocks/db";
import { MOCK_REQUEST_ID, sdb } from "@/mocks/scenarioDb";
import { server } from "@/mocks/server";
import { renderRoute } from "@/test/render";

const PATH = `/projects/${MOCK_PROJECT_ID}/requests/${MOCK_REQUEST_ID}/scenarios`;

async function renderScenarios() {
  const utils = renderRoute(PATH);
  await screen.findByTestId("scenario-SC-01");
  return utils;
}

const row = (code: string) => screen.getByTestId(`scenario-${code}`);

describe("UI-02-5 시나리오 · 케이스 조회", () => {
  it("요약과 범례를 보여 주고 범례 합이 전체와 같다", async () => {
    await renderScenarios();
    expect(screen.getByRole("heading", { name: /생성된 시나리오\s*6/ })).toBeInTheDocument();
    const legend = screen.getByRole("list", { name: "상태별 시나리오 수" });
    const counts = within(legend)
      .getAllByRole("listitem")
      .map((li) => Number(/(\d+)$/.exec(li.textContent ?? "")?.[1]));
    expect(within(legend).getByText("승인 4")).toBeInTheDocument();
    expect(within(legend).getByText("검토 필요 1")).toBeInTheDocument();
    expect(within(legend).getByText("가드 재생성 1")).toBeInTheDocument();
    expect(counts.reduce((a, b) => a + b, 0)).toBe(6);
    expect(screen.getByText("REQ-0142")).toBeInTheDocument();
  });

  it("승인된 시나리오만 체크할 수 있다", async () => {
    await renderScenarios();
    expect(within(row("SC-01")).getByRole("checkbox")).toBeEnabled();
    expect(within(row("SC-05")).getByRole("checkbox")).toBeDisabled();
    expect(within(row("SC-06")).getByRole("checkbox")).toBeDisabled();
  });

  it("가드 재생성 중 사유와 횟수, 끝나면 가드 실패와 카탈로그 수정 필요를 보여 준다", async () => {
    await renderScenarios();
    expect(
      within(row("SC-06")).getByText("가드 실패: 카탈로그에 'cart-remove-button' 요소가 없어 재생성 중 (2/3회)"),
    ).toBeInTheDocument();
    expect(within(row("SC-06")).getByText("생성 중")).toBeInTheDocument();

    await waitFor(() => expect(within(row("SC-06")).getByText("가드 실패")).toBeInTheDocument());
    expect(within(row("SC-06")).getByText("· 카탈로그 수정 필요")).toBeInTheDocument();
    expect(within(row("SC-06")).getByText(/\(3\/3회\)/)).toBeInTheDocument();

    await userEvent.setup().click(within(row("SC-06")).getByRole("button", { name: "SC-06 펼치기" }));
    expect(within(row("SC-06")).getByRole("list", { name: "가드 실패 항목" })).toHaveTextContent("카탈로그에 없음");
  });

  it("검토 필요 시나리오를 승인하면 범례와 체크 가능 여부가 바뀐다", async () => {
    const user = userEvent.setup();
    await renderScenarios();
    await user.click(within(row("SC-05")).getByRole("button", { name: "SC-05 펼치기" }));
    await user.click(within(row("SC-05")).getByRole("button", { name: "승인" }));

    await waitFor(() => expect(within(row("SC-05")).getByRole("checkbox")).toBeEnabled());
    expect(within(screen.getByRole("list", { name: "상태별 시나리오 수" })).getByText("승인 5")).toBeInTheDocument();
  });

  it("반려하면 반려 상태가 된다", async () => {
    const user = userEvent.setup();
    await renderScenarios();
    await user.click(within(row("SC-05")).getByRole("button", { name: "SC-05 펼치기" }));
    await user.click(within(row("SC-05")).getByRole("button", { name: "반려" }));
    await within(row("SC-05")).findByText("반려");
    expect(within(screen.getByRole("list", { name: "상태별 시나리오 수" })).getByText("반려 1")).toBeInTheDocument();
  });

  it("승인·반려가 409로 거부되면 사유를 알린다", async () => {
    server.use(
      http.post("*/api/v1/scenarios/:scenarioId/approve", () =>
        HttpResponse.json(
          { status: 409, code: "INVALID_STATE_TRANSITION", title: "불가", detail: "검토 필요 상태에서만 승인할 수 있습니다." },
          { status: 409, headers: { "Content-Type": "application/problem+json" } },
        ),
      ),
    );
    const user = userEvent.setup();
    await renderScenarios();
    await user.click(within(row("SC-05")).getByRole("button", { name: "SC-05 펼치기" }));
    await user.click(within(row("SC-05")).getByRole("button", { name: "승인" }));
    expect(await screen.findByText("SC-05 승인하지 못했습니다: 검토 필요 상태에서만 승인할 수 있습니다.")).toBeInTheDocument();
  });

  it("케이스 상세에서 기대값과 일관성만 확인 항목의 이유를 보여 준다", async () => {
    const user = userEvent.setup();
    await renderScenarios();
    await user.click(within(row("SC-01")).getByRole("button", { name: "SC-01 펼치기" }));
    await user.click(within(row("SC-01")).getByRole("button", { name: "TC-01 상세" }));

    const dialog = await screen.findByRole("dialog", { name: /TC-01/ });
    expect(within(dialog).getByText("승인할 기대값 3")).toBeInTheDocument();
    expect(within(dialog).getByText("일관성만 확인")).toBeInTheDocument();
    expect(within(dialog).getByText("이유: 실행마다 새로 만들어져 값을 미리 알 수 없음")).toBeInTheDocument();
    expect(within(dialog).getByText(/1개 항목은 값을 미리 정하지 않고/)).toBeInTheDocument();
    expect(within(dialog).getByText("고치면 시나리오 승인이 풀려 다시 승인해야 합니다.")).toBeInTheDocument();
  });

  it("기대값을 고치면 저장되고 시나리오 승인이 풀린다", async () => {
    const user = userEvent.setup();
    await renderScenarios();
    await user.click(within(row("SC-01")).getByRole("button", { name: "SC-01 펼치기" }));
    await user.click(within(row("SC-01")).getByRole("button", { name: "TC-01 상세" }));
    const dialog = await screen.findByRole("dialog", { name: /TC-01/ });
    await user.click(within(dialog).getByRole("button", { name: "수정" }));
    expect(within(dialog).getByText(/저장하면 시나리오 승인이 풀려/)).toBeInTheDocument();

    const value = within(dialog).getByRole("textbox", { name: "기대값 2 값" });
    await user.clear(value);
    await user.type(value, "3");
    await user.click(within(dialog).getByRole("button", { name: "저장" }));

    await within(dialog).findByRole("button", { name: "수정" });
    expect(within(dialog).getByText("3")).toBeInTheDocument();
    await waitFor(() => expect(within(row("SC-01")).getByText("검토 필요")).toBeInTheDocument());
    expect(within(row("SC-01")).getByRole("checkbox")).toBeDisabled();
  });

  it("일관성만 확인으로 바꾸고 이유를 비우면 저장하지 않는다", async () => {
    let patched = false;
    server.use(
      http.patch("*/api/v1/test-cases/:id", () => {
        patched = true;
        return HttpResponse.json({}, { status: 500 });
      }),
    );
    const user = userEvent.setup();
    await renderScenarios();
    await user.click(within(row("SC-05")).getByRole("button", { name: "SC-05 펼치기" }));
    await user.click(within(row("SC-05")).getByRole("button", { name: "TC-20 상세" }));
    const dialog = await screen.findByRole("dialog", { name: /TC-20/ });
    await user.click(within(dialog).getByRole("button", { name: "수정" }));
    await user.selectOptions(within(dialog).getByRole("combobox", { name: "기대값 1 방식" }), "consistency");
    await user.click(within(dialog).getByRole("button", { name: "저장" }));

    expect(within(dialog).getByText("일관성만 확인하는 이유를 입력해 주세요.")).toBeInTheDocument();
    expect(patched).toBe(false);
  });

  it("다시 생성하면 생성 중을 거쳐 새 번호의 케이스로 바뀐다", async () => {
    const user = userEvent.setup();
    await renderScenarios();
    await user.click(within(row("SC-05")).getByRole("button", { name: "SC-05 펼치기" }));
    await user.click(within(row("SC-05")).getByRole("button", { name: "다시 생성" }));
    const dialog = await screen.findByRole("dialog", { name: "SC-05 다시 생성" });
    await user.type(within(dialog).getByRole("textbox"), "만료 쿠폰 케이스를 보강해 줘");
    await user.click(within(dialog).getByRole("button", { name: "다시 생성" }));

    await waitFor(() => expect(within(row("SC-05")).getByText("검토 필요")).toBeInTheDocument());
    expect(within(row("SC-05")).queryByText("TC-19")).not.toBeInTheDocument();
    expect(within(row("SC-05")).getByText("TC-21")).toBeInTheDocument();
    const scenario = sdb.scenarios.find((s) => s.code === "SC-05");
    expect(scenario?.testCases.filter((c) => !c.isActive).map((c) => c.code)).toEqual(["TC-19", "TC-20"]);
  });

  it("시나리오 이름을 고치면 저장되고 승인이 풀린다", async () => {
    const user = userEvent.setup();
    await renderScenarios();
    await user.click(within(row("SC-02")).getByRole("button", { name: "SC-02 수정" }));
    const dialog = await screen.findByRole("dialog", { name: "SC-02 수정" });
    expect(within(dialog).getByText("저장하면 승인이 풀려 '검토 필요'로 돌아갑니다.")).toBeInTheDocument();
    const title = within(dialog).getByRole("textbox", { name: "시나리오 이름" });
    await user.clear(title);
    await user.type(title, "장바구니 수량을 바꾼다");
    await user.click(within(dialog).getByRole("button", { name: "저장" }));

    await within(row("SC-02")).findByText("장바구니 수량을 바꾼다");
    await waitFor(() => expect(within(row("SC-02")).getByText("검토 필요")).toBeInTheDocument());
  });

  it("요구사항 ID를 비우면 null로 보내 지운다", async () => {
    let sent: unknown;
    server.events.on("request:start", async ({ request }) => {
      if (request.method === "PATCH" && request.url.includes("/scenarios/")) sent = await request.clone().json();
    });
    const user = userEvent.setup();
    await renderScenarios();
    await user.click(within(row("SC-02")).getByRole("button", { name: "SC-02 수정" }));
    const dialog = await screen.findByRole("dialog", { name: "SC-02 수정" });
    await user.clear(within(dialog).getByRole("textbox", { name: "요구사항 ID" }));
    await user.click(within(dialog).getByRole("button", { name: "저장" }));

    await waitFor(() => expect(within(row("SC-02")).queryByText("FR-CART-02")).not.toBeInTheDocument());
    expect(sent).toEqual({ title: "장바구니 제품의 수량을 변경한다", scopes: ["UI", "DB"], requirementRef: null });
    server.events.removeAllListeners();
  });

  it("재생성이 실패해 옛 내용이 남으면 guard.message를 보여 준다", async () => {
    const sc = sdb.scenarios.find((s) => s.code === "SC-05");
    if (sc) sc.guard = { ...sc.guard, message: "재생성 실패: AI 서버 응답 시간 초과" };
    await renderScenarios();
    expect(within(row("SC-05")).getByText("재생성 실패: AI 서버 응답 시간 초과")).toBeInTheDocument();
  });

  it("가드 실패 시나리오를 고치면 검토 필요가 되고 이전 가드 결과가 남는다", async () => {
    const sc = sdb.scenarios.find((s) => s.code === "SC-05");
    if (sc)
      sc.guard = {
        attempt: 3,
        maxAttempts: 3,
        message: "카탈로그에 'coupon-input' 요소가 없습니다",
        catalogGap: true,
        failures: [{ kind: "CATALOG_GAP", message: "카탈로그에 'coupon-input' 요소가 없습니다", subject: "coupon-input" }],
      };
    const user = userEvent.setup();
    await renderScenarios();
    expect(within(row("SC-05")).getByText("이전 생성의 가드 결과 · 카탈로그에 'coupon-input' 요소가 없습니다")).toBeInTheDocument();
    await user.click(within(row("SC-05")).getByRole("button", { name: "SC-05 펼치기" }));
    expect(within(row("SC-05")).getByRole("list", { name: "이전 생성의 가드 실패 항목" })).toHaveTextContent("coupon-input");
  });

  it("목록을 불러오지 못하면 오류와 다시 시도를 보여 준다", async () => {
    server.use(
      http.get("*/api/v1/test-requests/:id/scenarios", () =>
        HttpResponse.json(
          { status: 404, code: "RESOURCE_NOT_FOUND", title: "없음", detail: "요청을 찾을 수 없습니다." },
          { status: 404, headers: { "Content-Type": "application/problem+json" } },
        ),
      ),
    );
    renderRoute(PATH);
    expect(await screen.findByText("요청을 찾을 수 없습니다.")).toBeInTheDocument();
  });

  it("사이드바 시나리오 승인은 가장 최근 생성 완료 요청으로 연다", async () => {
    const { router } = renderRoute(`/projects/${MOCK_PROJECT_ID}/scenarios`);
    await waitFor(() => expect(router.state.location.pathname).toBe(PATH));
    await screen.findByTestId("scenario-SC-01");
    expect(screen.getByRole("link", { name: "시나리오 승인" })).toHaveAttribute("aria-current", "page");
  });
});

describe("UI-02-1 · UI-02-1B · 생성 완료 모달", () => {
  async function openFlow() {
    const user = userEvent.setup();
    renderRoute(`/projects/${MOCK_PROJECT_ID}/requests`);
    await screen.findByText("REQ-0142");
    await user.click(screen.getByRole("button", { name: "테스트 시나리오 생성" }));
    const dialog = await screen.findByRole("dialog", { name: "테스트 시나리오 입력" });
    return { user, dialog };
  }

  it("입력 → 후보 선택 → 생성 대기 → 완료 → 시나리오 화면", async () => {
    db.kb.status = "READY";
    const { user, dialog } = await openFlow();
    const input = within(dialog).getByRole("textbox", { name: "테스트 요청" });
    await user.type(input, "비회원 장바구니가 로그인 후에도 유지되는지 봐줘");
    expect(within(dialog).getByText("26 / 500자")).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "생성하기" }));

    const select = await screen.findByRole("dialog", { name: "테스트 시나리오 선택" });
    expect(within(select).getByText("비회원 장바구니가 로그인 후에도 유지되는지 봐줘")).toBeInTheDocument();
    const radios = within(select).getAllByRole("radio");
    expect(radios).toHaveLength(5); // 후보 4개 + 기타
    expect(radios[0]).toBeChecked();
    await user.click(radios[1]!);
    await user.click(within(select).getByRole("button", { name: "테스트 케이스 생성하기" }));

    const done = await screen.findByRole("dialog", { name: "테스트 케이스 생성이 완료되었습니다" }, { timeout: 3000 });
    expect(within(done).getByText("시나리오 2개, 테스트 케이스 3개를 만들었어요.")).toBeInTheDocument();
    const created = sdb.requests[0];
    expect(created?.selectedText).toContain("회원과 비회원 각각");
    await user.click(within(done).getByRole("button", { name: "확인" }));

    expect(await screen.findByText(created?.code ?? "")).toBeInTheDocument();
    await screen.findByTestId("scenario-SC-01");
    expect(screen.getByRole("heading", { name: /생성된 시나리오\s*2/ })).toBeInTheDocument();
  });

  it("기타 직접 입력으로 생성할 수 있다", async () => {
    db.kb.status = "READY";
    const { user, dialog } = await openFlow();
    await user.type(within(dialog).getByRole("textbox", { name: "테스트 요청" }), "쿠폰 결제를 확인해줘");
    await user.click(within(dialog).getByRole("button", { name: "생성하기" }));
    const select = await screen.findByRole("dialog", { name: "테스트 시나리오 선택" });
    await user.click(within(select).getByText("기타"));
    const button = within(select).getByRole("button", { name: "테스트 케이스 생성하기" });
    expect(button).toBeDisabled();
    await user.type(within(select).getByRole("textbox", { name: "직접 입력" }), "정액 쿠폰으로 결제");
    await user.click(button);
    await screen.findByRole("dialog", { name: "테스트 케이스 생성이 완료되었습니다" }, { timeout: 3000 });
    expect(sdb.requests[0]?.selectionSource).toBe("CUSTOM");
  });

  it("이전을 누르면 입력 화면으로 돌아가고 입력이 남는다", async () => {
    db.kb.status = "READY";
    const { user, dialog } = await openFlow();
    await user.type(within(dialog).getByRole("textbox", { name: "테스트 요청" }), "결제 확인");
    await user.click(within(dialog).getByRole("button", { name: "생성하기" }));
    const select = await screen.findByRole("dialog", { name: "테스트 시나리오 선택" });
    await user.click(within(select).getByRole("button", { name: "이전" }));

    const back = await screen.findByRole("dialog", { name: "테스트 시나리오 입력" });
    expect(within(back).getByRole("textbox", { name: "테스트 요청" })).toHaveValue("결제 확인");
    // 이전 요청은 후보 선택 대기로 남는다
    expect(sdb.requests[0]?.status).toBe("AWAITING_SELECTION");
  });

  it("지식 베이스가 최신이 아니면 안내하고 생성하기를 막는다", async () => {
    const { user, dialog } = await openFlow();
    await user.type(within(dialog).getByRole("textbox", { name: "테스트 요청" }), "결제 확인");
    expect(within(dialog).getByText(/지식 베이스가 최신 상태가 아니어서/)).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "생성하기" })).toBeDisabled();
  });

  it("정제가 실패하면 사유와 다시 입력을 보여 준다", async () => {
    db.kb.status = "READY";
    const { user, dialog } = await openFlow();
    await user.type(within(dialog).getByRole("textbox", { name: "테스트 요청" }), "실패하는 요청");
    await user.click(within(dialog).getByRole("button", { name: "생성하기" }));
    const failed = await screen.findByRole("dialog", { name: "요청을 처리하지 못했습니다" });
    expect(within(failed).getByText(/관련 명세를 찾지 못했습니다/)).toBeInTheDocument();
    await user.click(within(failed).getByRole("button", { name: "다시 입력" }));
    expect(await screen.findByRole("dialog", { name: "테스트 시나리오 입력" })).toBeInTheDocument();
  });

  it("모달을 닫았다가 목록에서 진행 중인 요청을 누르면 이어서 보여 준다", async () => {
    db.kb.status = "READY";
    const { user, dialog } = await openFlow();
    await user.type(within(dialog).getByRole("textbox", { name: "테스트 요청" }), "주문 취소 확인");
    await user.click(within(dialog).getByRole("button", { name: "생성하기" }));
    const select = await screen.findByRole("dialog", { name: "테스트 시나리오 선택" });
    await user.click(within(select).getByRole("button", { name: "닫기" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    await user.click(await screen.findByText("주문 취소 확인"));
    expect(await screen.findByRole("dialog", { name: "테스트 시나리오 선택" })).toBeInTheDocument();
  });
});

