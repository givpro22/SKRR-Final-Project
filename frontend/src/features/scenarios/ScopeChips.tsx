import type { VerificationScope } from "@/api/types";
import { SCOPE_ORDER } from "./labels";

/** UI · API · DB 칩. 캡처처럼 모노스페이스 글자에 얇은 테두리 */
export function ScopeChips({ scopes }: { scopes: VerificationScope[] }) {
  const ordered = SCOPE_ORDER.filter((scope) => scopes.includes(scope));
  return (
    <span className="inline-flex gap-1" aria-label={`검증 범위 ${ordered.join(", ")}`}>
      {ordered.map((scope) => (
        <span
          key={scope}
          className="inline-flex h-[22px] items-center rounded-md border border-line-strong/70 px-1.5 font-mono text-[11px] font-medium text-ink/80"
        >
          {scope}
        </span>
      ))}
    </span>
  );
}
