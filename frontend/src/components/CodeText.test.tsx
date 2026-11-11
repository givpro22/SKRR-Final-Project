import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CodeText } from "./CodeText";

describe("CodeText", () => {
  it("백틱 부분을 code로 그리고 백틱은 보이지 않는다", () => {
    const { container } = render(<CodeText text="`/cart` 화면에서 `cart-remove-button` 클릭" />);
    expect(container.textContent).toBe("/cart 화면에서 cart-remove-button 클릭");
    expect([...container.querySelectorAll("code")].map((c) => c.textContent)).toEqual(["/cart", "cart-remove-button"]);
  });

  it("짝이 맞지 않는 백틱은 그대로 둔다", () => {
    const { container } = render(<CodeText text="값 `없음" />);
    expect(container.textContent).toBe("값 `없음");
  });
});
