import { CircleAlert } from "lucide-react";
import { forwardRef } from "react";
import type { DocumentType } from "@/api/types";
import { withObjectParticle } from "@/lib/korean";
import { documentTypeInfo } from "./documentTypes";

interface Props {
  missing: DocumentType[];
}

/** FR-01 수용기준: 필수 문서가 빠지면 등록을 거부하고 빠진 항목을 알려 준다. */
export const MissingDocumentsBanner = forwardRef<HTMLDivElement, Props>(function MissingDocumentsBanner(
  { missing },
  ref,
) {
  const names = missing.map((type) => {
    const info = documentTypeInfo[type];
    return `${info.label}(${info.description})`;
  });
  return (
    <div
      ref={ref}
      role="alert"
      tabIndex={-1}
      className="flex gap-3 rounded-xl bg-danger-soft px-4 py-4 outline-none"
    >
      <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-danger" />
      <div>
        <p className="text-[13px] font-semibold text-danger">필수 문서 {missing.length}개가 빠져 등록할 수 없습니다</p>
        <p className="mt-1 text-xs text-ink/70">
          {withObjectParticle(names.join(", "))} 추가하면 지식 베이스 구축이 활성화됩니다.
        </p>
      </div>
    </div>
  );
});
