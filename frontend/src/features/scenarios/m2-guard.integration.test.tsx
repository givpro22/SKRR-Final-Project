// 가짜 LLM 표시(#fake-...)로 실제 백엔드·AI의 가드·실패 경로를 화면에서 확인한다 (ai/app/llm/fake_responders.py).
// GUARD_RETRY를 보려면 AI를 FAKE_LLM_DELAY_MS=800 정도로 띄운다.
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { renderRoute } from "@/test/render";

const PROJECT_ID = process.env.INTEGRATION_PROJECT_ID ?? "00000000-0000-0000-0000-0000000000a1";
const LONG = { timeout: 120_000 };

/** 직접 입력으로 요청을 만들고 끝난 모달을 돌려준다 */
async function createWithCustomText(customText: string) {
  const user = userEvent.setup();
  const utils = renderRoute(`/projects/${PROJECT_ID}/requests`);
  await screen.findByRole("heading", { name: "테스트 요청" });
  await user.click(screen.getAllByRole("button", { name: "테스트 시나리오 생성" })[0]!);
  const input = await screen.findByRole("dialog", { name: "테스트 시나리오 입력" });
  await waitFor(() => expect(within(input).queryByText(/지식 베이스가 최신 상태가 아니어서/)).not.toBeInTheDocument());
  await user.type(within(input).getByRole("textbox", { name: "테스트 요청" }), "장바구니 상품 삭제 확인");
  await user.click(within(input).getByRole("button", { name: "생성하기" }));
  const select = await screen.findByRole("dialog", { name: "테스트 시나리오 선택" }, LONG);
  await user.click(within(select).getByText("기타"));
  await user.type(within(select).getByRole("textbox", { name: "직접 입력" }), customText);
  await user.click(within(select).getByRole("button", { name: "테스트 케이스 생성하기" }));
  return { user, ...utils };
}

async function openScenarios(user: ReturnType<typeof userEvent.setup>) {
  const done = await screen.findByRole("dialog", { name: "테스트 케이스 생성이 완료되었습니다" }, LONG);
  await user.click(within(done).getByRole("button", { name: "확인" }));
  await screen.findByRole("heading", { name: /생성된 시나리오/ }, LONG);
  return screen.getAllByTestId(/^scenario-SC-/);
}

describe("M2 가드·실패 경로 (실제 백엔드·AI, 가짜 LLM)", () => {
  it("#fake-catalog-gap → 가드 실패와 카탈로그 수정 필요", async () => {
    const { user } = await createWithCustomText("장바구니 상품 삭제 #fake-catalog-gap");
    const rows = await openScenarios(user);
    const failed = rows.find((r) => within(r).queryByText("가드 실패"));
    expect(failed).toBeDefined();
    expect(within(failed!).getByText(/^가드 실패: .+ \(\d\/3회\)$/)).toBeInTheDocument();
    expect(within(failed!).queryByText(/가드 실패: 가드 실패:/)).not.toBeInTheDocument();
    expect(within(failed!).getByText("· 카탈로그 수정 필요")).toBeInTheDocument();
    expect(within(failed!).getByRole("checkbox")).toBeDisabled();
  });

  it("#fake-guard-fail → 3회 실패, 다시 생성 안내", async () => {
    const { user } = await createWithCustomText("장바구니 상품 삭제 #fake-guard-fail");
    const rows = await openScenarios(user);
    const failed = rows.find((r) => within(r).queryByText("가드 실패"));
    expect(failed).toBeDefined();
    expect(within(failed!).getByText(/\(3\/3회\)$/)).toBeInTheDocument();
    expect(within(failed!).getByText("· 다시 생성해 주세요")).toBeInTheDocument();
  });

  it("#fake-llm-down → 요청 실패 사유", async () => {
    await createWithCustomText("장바구니 상품 삭제 #fake-llm-down");
    const failed = await screen.findByRole("dialog", { name: "요청을 처리하지 못했습니다" }, LONG);
    expect(within(failed).getByRole("button", { name: "다시 입력" })).toBeInTheDocument();
  });

  it("#fake-guard-retry로 만든 시나리오를 다시 생성하면 가드 재생성(2/3회)을 거친다", async () => {
    const { user } = await createWithCustomText("장바구니 상품 삭제 #fake-guard-retry");
    const rows = await openScenarios(user);
    const code = rows[0]!.dataset.testid!.replace("scenario-", "");
    const row = () => screen.getByTestId(`scenario-${code}`);
    await user.click(within(row()).getByRole("button", { name: `${code} 펼치기` }));
    await user.click(within(row()).getByRole("button", { name: "다시 생성" }));
    const regen = await screen.findByRole("dialog", { name: `${code} 다시 생성` });
    await user.click(within(regen).getByRole("button", { name: "다시 생성" }));

    let sawRetry = false;
    const seen = new Set<string>();
    // 먼저 재생성이 시작된 것(생성 중)을 본 뒤, 끝날 때까지 지켜본다
    await waitFor(() => {
      if (within(row()).queryByText(/^가드 실패: .+ \(2\/3회\)$/)) sawRetry = true;
      expect(within(row()).queryAllByText("생성 중").length).toBeGreaterThan(0);
    }, LONG);
    await waitFor(() => {
      seen.add((row().textContent ?? "").replace(/\s+/g, " ").slice(0, 160));
      if (within(row()).queryByText(/^가드 실패: .+ \(2\/3회\)$/)) sawRetry = true;
      expect(within(row()).queryAllByText("생성 중")).toHaveLength(0);
      expect(within(row()).queryByText("가드 재생성")).not.toBeInTheDocument();
    }, LONG);
    // AI를 FAKE_LLM_DELAY_MS 없이 띄우면 GUARD_RETRY가 조회 사이에 지나갈 수 있다. 그때는 INTEGRATION_EXPECT_RETRY=0
    if (process.env.INTEGRATION_EXPECT_RETRY !== "0") expect(sawRetry, [...seen].join("\n")).toBe(true);
    expect(within(row()).queryByText(/가드 실패: 가드 실패:/)).not.toBeInTheDocument();
  });
});
