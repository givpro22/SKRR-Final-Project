import { Fragment } from "react";

/**
 * 백틱으로 감싼 부분(`/cart`, `cart-remove-button`)을 고정폭 인라인 코드로 그린다.
 * AI는 화면 경로·testId·API를 가드가 읽을 수 있게 백틱으로 감싸 쓴다 (QA Q-M2-2).
 */
export function CodeText({ text }: { text: string }) {
  const parts = text.split(/`([^`]+)`/);
  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <code key={i} className="rounded bg-page px-1 py-px font-mono text-[0.92em] text-ink">
            {part}
          </code>
        ) : (
          <Fragment key={i}>{part}</Fragment>
        ),
      )}
    </>
  );
}
