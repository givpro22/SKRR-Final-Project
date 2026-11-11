import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { Modal } from "./Modal";

describe("Modal", () => {
  it("부모가 새 onClose로 다시 그려도 입력 중인 포커스를 빼앗지 않는다", async () => {
    const user = userEvent.setup();
    const view = (onClose: () => void) => (
      <Modal open title="입력" onClose={onClose}>
        <input aria-label="글" />
      </Modal>
    );
    const { rerender } = render(view(() => undefined));
    const input = screen.getByRole("textbox", { name: "글" });
    await user.type(input, "가나");
    // 목록 조회 등으로 부모가 다시 그려지면 onClose가 새 함수가 된다
    rerender(view(() => undefined));
    await user.keyboard("다");
    expect(input).toHaveFocus();
    expect(input).toHaveValue("가나다");
  });

  it("Escape는 최신 onClose를 부른다", async () => {
    const user = userEvent.setup();
    const calls: string[] = [];
    const view = (name: string) => <Modal open title="입력" onClose={() => calls.push(name)} />;
    const { rerender } = render(view("first"));
    rerender(view("second"));
    await user.keyboard("{Escape}");
    expect(calls).toEqual(["second"]);
  });
});
