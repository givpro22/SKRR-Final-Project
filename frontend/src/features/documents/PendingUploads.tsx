import { FileUp, X } from "lucide-react";
import type { DocumentType } from "@/api/types";
import { Button } from "@/components/Button";
import { formatBytes } from "@/lib/format";
import { DOCUMENT_TYPE_ORDER, documentTypeInfo } from "./documentTypes";

export interface PendingUpload {
  id: string;
  file: File;
  type: DocumentType;
}

interface Props {
  items: PendingUpload[];
  existingTypes: ReadonlySet<DocumentType>;
  onChangeType: (id: string, type: DocumentType) => void;
  onUpload: (item: PendingUpload) => void;
  onRemove: (id: string) => void;
}

/** 끌어다 놓은 파일은 문서 종류를 확인받은 뒤 올린다. 확장자만으로는 종류를 알 수 없기 때문이다. */
export function PendingUploads({ items, existingTypes, onChangeType, onUpload, onRemove }: Props) {
  if (items.length === 0) return null;
  return (
    <ul aria-label="올릴 파일" className="mt-3 flex flex-col gap-2">
      {items.map((item) => (
        <li key={item.id} className="flex items-center gap-3 rounded-xl border border-line bg-surface px-4 py-3">
          <FileUp aria-hidden className="size-4 shrink-0 text-muted" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-medium">{item.file.name}</p>
            <p className="text-xs text-muted">
              {formatBytes(item.file.size)}
              {existingTypes.has(item.type) && " · 기존 문서를 새 버전으로 바꿉니다"}
            </p>
          </div>
          <label className="sr-only" htmlFor={`pending-type-${item.id}`}>
            문서 종류
          </label>
          <select
            id={`pending-type-${item.id}`}
            value={item.type}
            onChange={(event) => {
              const next = DOCUMENT_TYPE_ORDER.find((type) => type === event.target.value);
              if (next) onChangeType(item.id, next);
            }}
            className="h-8 rounded-lg border border-line-strong/60 bg-surface px-2 text-xs outline-none focus:border-focus"
          >
            {DOCUMENT_TYPE_ORDER.map((type) => (
              <option key={type} value={type}>
                {documentTypeInfo[type].label}
              </option>
            ))}
          </select>
          <Button size="sm" variant="primary" onClick={() => onUpload(item)}>
            올리기
          </Button>
          <button
            type="button"
            aria-label={`${item.file.name} 취소`}
            onClick={() => onRemove(item.id)}
            className="flex size-8 items-center justify-center rounded-lg text-muted hover:bg-page hover:text-ink"
          >
            <X aria-hidden className="size-4" />
          </button>
        </li>
      ))}
    </ul>
  );
}
