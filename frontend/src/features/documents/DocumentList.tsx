import clsx from "clsx";
import { Braces, Check, Database, Download, Ellipsis, FileText, LayoutList, RefreshCw, Trash2, Upload, type LucideIcon } from "lucide-react";
import type { Document, DocumentType } from "@/api/types";
import { Badge } from "@/components/Badge";
import { Button } from "@/components/Button";
import { Menu } from "@/components/Menu";
import { Spinner } from "@/components/Spinner";
import { formatBytes } from "@/lib/format";
import { DOCUMENT_TYPE_ORDER, documentTypeInfo, summaryParts } from "./documentTypes";
import { documentStatusView } from "./statusLabels";

const typeIcon: Record<DocumentType, LucideIcon> = {
  REQUIREMENT: FileText,
  API_SPEC: Braces,
  CATALOG: LayoutList,
  TEST_DATA: Database,
};

interface DocumentListProps {
  documents: Document[];
  /** 서버가 알려 준 빠진 필수 문서 (KnowledgeBase.missingDocumentTypes) */
  missingTypes: ReadonlySet<DocumentType>;
  uploadingTypes: ReadonlySet<DocumentType>;
  onPickFile: (type: DocumentType) => void;
  onDownload: (doc: Document) => void;
  onDelete: (doc: Document) => void;
}

export function DocumentList({ documents, missingTypes, uploadingTypes, onPickFile, onDownload, onDelete }: DocumentListProps) {
  const byType = new Map(documents.map((doc) => [doc.type, doc]));
  return (
    <ul className="divide-y divide-line rounded-card border border-line bg-surface [&>li:first-child]:rounded-t-card [&>li:last-child]:rounded-b-card">
      {DOCUMENT_TYPE_ORDER.map((type) => (
        <DocumentRow
          key={type}
          type={type}
          doc={byType.get(type)}
          missing={missingTypes.has(type)}
          uploading={uploadingTypes.has(type)}
          onPickFile={onPickFile}
          onDownload={onDownload}
          onDelete={onDelete}
        />
      ))}
    </ul>
  );
}

interface DocumentRowProps extends Omit<DocumentListProps, "documents" | "missingTypes" | "uploadingTypes"> {
  type: DocumentType;
  doc: Document | undefined;
  missing: boolean;
  uploading: boolean;
}

function DocumentRow({ type, doc, missing, uploading, onPickFile, onDownload, onDelete }: DocumentRowProps) {
  const info = documentTypeInfo[type];
  const Icon = typeIcon[type];
  const highlight = !doc && missing;

  return (
    <li
      data-testid={`document-row-${type}`}
      data-missing={highlight || undefined}
      className={clsx("flex min-h-[74px] items-center gap-4 px-4 py-3.5", highlight && "bg-danger-row")}
    >
      <span
        className={clsx(
          "flex size-9 shrink-0 items-center justify-center rounded-lg border",
          highlight ? "border-danger-soft bg-danger-soft text-danger" : "border-line bg-page text-ink/70",
        )}
      >
        <Icon aria-hidden className="size-4" strokeWidth={1.75} />
      </span>

      <div className="min-w-0 flex-1">
        <p className="flex items-baseline gap-2">
          <span className="text-sm font-bold">{info.label}</span>
          <span className="text-[11px] text-muted">{info.required ? "필수" : "선택"}</span>
        </p>
        {doc ? (
          <>
            <p className="mt-1 truncate text-xs text-muted">
              {[doc.originalFilename, formatBytes(doc.sizeBytes), ...summaryParts(doc.summary)].join(" · ")}
            </p>
            {(doc.status === "FAILED" || doc.status === "SKIPPED") && doc.errorMessage && (
              <p className={clsx("mt-1 truncate text-xs", doc.status === "FAILED" ? "text-danger" : "text-warning")} title={doc.errorMessage}>
                {doc.errorMessage}
              </p>
            )}
          </>
        ) : (
          <p className={clsx("mt-1 text-xs", highlight ? "text-danger" : "text-muted")}>
            {info.description} ({info.formats})
          </p>
        )}
      </div>

      {uploading ? (
        <Badge tone="accent" icon={<Spinner className="size-3" />}>
          업로드 중
        </Badge>
      ) : doc ? (
        <>
          <DocumentStatusBadge doc={doc} />
          <Menu
            label={`${info.label} 메뉴`}
            items={[
              { key: "download", label: "다운로드", icon: <Download aria-hidden className="size-3.5" />, onSelect: () => onDownload(doc) },
              { key: "replace", label: "새 버전 올리기", icon: <RefreshCw aria-hidden className="size-3.5" />, onSelect: () => onPickFile(type) },
              { key: "delete", label: "삭제", danger: true, icon: <Trash2 aria-hidden className="size-3.5" />, onSelect: () => onDelete(doc) },
            ]}
            trigger={({ open, toggle }) => (
              <button
                type="button"
                aria-label={`${info.label} 더보기`}
                aria-haspopup="menu"
                aria-expanded={open}
                onClick={toggle}
                className="flex size-8 items-center justify-center rounded-lg text-muted hover:bg-page hover:text-ink"
              >
                <Ellipsis aria-hidden className="size-4" />
              </button>
            )}
          />
        </>
      ) : (
        <Button size="md" icon={<Upload aria-hidden className="size-4" />} onClick={() => onPickFile(type)} aria-label={`${info.label} 파일 선택`}>
          파일 선택
        </Button>
      )}
    </li>
  );
}

function DocumentStatusBadge({ doc }: { doc: Document }) {
  const view = documentStatusView(doc.status, doc.indexProgress);
  const icon =
    doc.status === "INDEXING" ? (
      <Spinner className="size-3" />
    ) : doc.status === "FAILED" || doc.status === "SKIPPED" || doc.status === "UPLOADED" ? undefined : (
      <Check aria-hidden className="size-3" />
    );
  return (
    <Badge tone={view.tone} icon={icon}>
      {view.label}
    </Badge>
  );
}
