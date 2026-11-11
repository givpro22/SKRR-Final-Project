// M2 화면을 실제 백엔드·AI에 붙여 확인한다. 기본 테스트에서는 빠지고 npm run test:integration으로만 돈다.
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { renderRoute } from "@/test/render";

const PROJECT_ID = process.env.INTEGRATION_PROJECT_ID ?? "00000000-0000-0000-0000-0000000000a1";
const LONG = { timeout: 120_000 };

describe("M2 실제 백엔드 연동", () => {
  it("요청 → 후보 선택 → 생성 완료 → UI-02-5 → 기대값 수정 → 승인 → 다시 생성", async () => {
    const user = userEvent.setup();
    const { router } = renderRoute(`/projects/${PROJECT_ID}/requests`);
    await screen.findByRole("heading", { name: "테스트 요청" });
    await user.click(screen.getAllByRole("button", { name: "테스트 시나리오 생성" })[0]!);

    // UI-02-1
    const input = await screen.findByRole("dialog", { name: "테스트 시나리오 입력" });
    await waitFor(() => expect(within(input).queryByText(/지식 베이스가 최신 상태가 아니어서/)).not.toBeInTheDocument());
    await user.type(within(input).getByRole("textbox", { name: "테스트 요청" }), "비회원 장바구니가 로그인 후에도 유지되는지 확인해줘");
    await user.click(within(input).getByRole("button", { name: "생성하기" }));

    // UI-02-1B
    const select = await screen.findByRole("dialog", { name: "테스트 시나리오 선택" }, LONG);
    const radios = within(select).getAllByRole("radio");
    console.info(`[M2] 후보 ${radios.length - 1}개`);
    expect(radios.length).toBeGreaterThanOrEqual(2);
    expect(radios[0]).toBeChecked();
    await user.click(within(select).getByRole("button", { name: "테스트 케이스 생성하기" }));

    // 생성 완료 모달
    const done = await screen.findByRole("dialog", { name: "테스트 케이스 생성이 완료되었습니다" }, LONG);
    const summaryText = within(done).getByText(/시나리오 \d+개, 테스트 케이스 \d+개를 만들었어요\./).textContent ?? "";
    console.info(`[M2] ${summaryText}`);
    const [, scenarioCount] = /시나리오 (\d+)개/.exec(summaryText) ?? [];
    await user.click(within(done).getByRole("button", { name: "확인" }));

    // UI-02-5
    await waitFor(() => expect(router.state.location.pathname).toMatch(/\/requests\/[^/]+\/scenarios$/));
    const heading = await screen.findByRole("heading", { name: /생성된 시나리오/ }, LONG);
    expect(heading).toHaveTextContent(`생성된 시나리오 ${scenarioCount}`);
    const legend = screen.getByRole("list", { name: "상태별 시나리오 수" });
    const sum = within(legend)
      .getAllByRole("listitem")
      .map((li) => Number(/(\d+)$/.exec(li.textContent ?? "")?.[1]))
      .reduce((a, b) => a + b, 0);
    expect(sum).toBe(Number(scenarioCount));
    console.info(`[M2] 범례 ${legend.textContent}`);

    const rows = screen.getAllByTestId(/^scenario-SC-/);
    const review = rows.find((r) => within(r).queryByText("검토 필요"));
    expect(review, "검토 필요 시나리오가 하나 이상 있어야 한다").toBeDefined();
    const code = review!.dataset.testid!.replace("scenario-", "");
    const reviewRow = () => screen.getByTestId(`scenario-${code}`);
    expect(within(reviewRow()).getByRole("checkbox")).toBeDisabled();

    // 케이스 상세와 기대값 수정
    await user.click(within(reviewRow()).getByRole("button", { name: `${code} 펼치기` }));
    const detailButtons = within(reviewRow()).getAllByRole("button", { name: /^TC-\d+ 상세$/ });
    const caseCode = detailButtons[0]!.getAttribute("aria-label")!.replace(" 상세", "");
    await user.click(detailButtons[0]!);
    const detail = await screen.findByRole("dialog", { name: new RegExp(caseCode) });
    await within(detail).findByText(/승인할 기대값 \d+/, undefined, LONG);
    console.info(`[M2] ${caseCode} ${within(detail).getByText(/승인할 기대값/).textContent}`);
    await user.click(within(detail).getByRole("button", { name: "수정" }));
    const firstMode = within(detail).getByRole("combobox", { name: "기대값 1 방식" });
    if ((firstMode as HTMLSelectElement).value === "consistency") {
      const reason = within(detail).getByRole("textbox", { name: "기대값 1 이유" });
      await user.clear(reason);
      await user.type(reason, "실행마다 달라지는 값 (통합 확인)");
    } else {
      const value = within(detail).getByRole("textbox", { name: "기대값 1 값" });
      await user.clear(value);
      await user.type(value, "통합확인값");
    }
    await user.click(within(detail).getByRole("button", { name: "저장" }));
    await within(detail).findByRole("button", { name: "수정" }, LONG);
    await user.click(within(detail).getByRole("button", { name: "닫기" }));

    // 승인
    await user.click(within(reviewRow()).getByRole("button", { name: "승인" }));
    await waitFor(() => expect(within(reviewRow()).getByRole("checkbox")).toBeEnabled(), LONG);

    // 다시 생성: 승인된 시나리오도 다시 만들 수 있고 승인이 풀린다
    const before = within(reviewRow()).getAllByRole("button", { name: /^TC-\d+ 상세$/ }).map((b) => b.getAttribute("aria-label"));
    await user.click(within(reviewRow()).getByRole("button", { name: "다시 생성" }));
    const regen = await screen.findByRole("dialog", { name: `${code} 다시 생성` });
    expect(within(regen).getByText("다시 만들면 승인이 풀립니다.")).toBeInTheDocument();
    await user.click(within(regen).getByRole("button", { name: "다시 생성" }));
    // "생성 중"은 케이스 수 자리와 상태 배지 두 곳에 나온다
    await waitFor(() => expect(within(reviewRow()).queryAllByText("생성 중").length).toBeGreaterThan(0), LONG);
    await waitFor(() => expect(within(reviewRow()).queryAllByText("생성 중")).toHaveLength(0), LONG);
    await waitFor(
      () => expect(within(reviewRow()).queryByText("검토 필요") ?? within(reviewRow()).queryByText("가드 실패")).not.toBeNull(),
      LONG,
    );
    const after = within(reviewRow()).queryAllByRole("button", { name: /^TC-\d+ 상세$/ }).map((b) => b.getAttribute("aria-label"));
    console.info(`[M2] 다시 생성 전 ${before.join(",")} → 후 ${after.join(",")}`);
    if (within(reviewRow()).queryByText("검토 필요")) {
      expect(after.some((c) => before.includes(c))).toBe(false);
    }
  });

  it("사이드바 시나리오 승인은 가장 최근 생성 완료 요청을 연다", async () => {
    const { router } = renderRoute(`/projects/${PROJECT_ID}/scenarios`);
    await waitFor(() => expect(router.state.location.pathname).toMatch(/\/requests\/[^/]+\/scenarios$/), LONG);
    await screen.findByRole("heading", { name: /생성된 시나리오/ }, LONG);
  });
});
