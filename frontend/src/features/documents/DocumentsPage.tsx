import { CircleAlert, DatabaseZap, Download, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/api/queries/keys";
import {
  fetchDocumentDownloadLink,
  fetchDocumentTemplate,
  isDocumentProcessing,
  useDeleteDocument,
  useDocuments,
  useUploadDocument,
} from "@/api/queries/documents";
import { useBuildKnowledgeBase, useKnowledgeBase } from "@/api/queries/knowledgeBase";
import { useActivities } from "@/api/queries/projects";
import { errorMessage, hasErrorCode } from "@/api/errors";
import type { Document, DocumentType } from "@/api/types";
import { useProjectContext } from "@/app/useProjectContext";
import { Button } from "@/components/Button";
import { Menu } from "@/components/Menu";
import { Modal } from "@/components/Modal";
import { PageHeader } from "@/components/PageHeader";
import { Spinner } from "@/components/Spinner";
import { ErrorBlock, LoadingBlock } from "@/components/StateViews";
import { openLink, saveBlob } from "@/lib/download";
import { withObjectParticle } from "@/lib/korean";
import { DocumentList } from "./DocumentList";
import { DOCUMENT_TYPE_ORDER, documentTypeInfo } from "./documentTypes";
import { MissingDocumentsBanner } from "./MissingDocumentsBanner";
import { PendingUploads, type PendingUpload } from "./PendingUploads";
import { ActivityList, KnowledgePreview, ReadinessPanel } from "./SidePanels";
import { TargetUrlField } from "./TargetUrlField";
import { UploadDropzone } from "./UploadDropzone";
import { acceptAttribute, ACCEPT_ATTRIBUTE, extensionsByType, fileExtension, validateFile } from "./validateFile";

const ACTIVITY_LIMIT = 6;

/** 끌어다 놓은 파일의 문서 종류 첫 추정값. 사용자가 확인하고 바꿀 수 있다. */
function guessType(file: File, existing: ReadonlySet<DocumentType>): DocumentType {
  const ext = fileExtension(file.name);
  const candidates = DOCUMENT_TYPE_ORDER.filter((type) => extensionsByType[type].includes(ext));
  return candidates.find((type) => !existing.has(type)) ?? candidates[0] ?? "REQUIREMENT";
}

let pendingSeq = 0;

export function DocumentsPage() {
  const { project } = useProjectContext();
  const projectId = project.id;

  // 구축 중에는 문서가 UPLOADED → INDEXING → INDEXED로 바뀌므로 문서 목록도 함께 조회한다.
  const kbStatus = useKnowledgeBase(projectId).data?.status;
  const documents = useDocuments(projectId, { poll: kbStatus === "BUILDING" });
  const processing = documents.data?.some(isDocumentProcessing) ?? false;
  const kb = useKnowledgeBase(projectId, { pollWhileIndexing: processing });
  const building = kb.data?.status === "BUILDING";
  const activities = useActivities(projectId, { limit: ACTIVITY_LIMIT, poll: processing || building });

  // 인덱싱이 끝나면 지식 베이스 수치와 최근 활동을 한 번 더 읽는다. 조회 간격이 멈추기 전의 마지막 변화를 놓치지 않기 위해서다.
  const queryClient = useQueryClient();
  const wasProcessing = useRef(false);
  useEffect(() => {
    if (wasProcessing.current && !processing) {
      void queryClient.invalidateQueries({ queryKey: queryKeys.knowledgeBase(projectId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.activities(projectId) });
    }
    wasProcessing.current = processing;
  }, [processing, queryClient, projectId]);

  const upload = useUploadDocument(projectId);
  const remove = useDeleteDocument(projectId);
  const build = useBuildKnowledgeBase(projectId);

  const [uploadingTypes, setUploadingTypes] = useState<ReadonlySet<DocumentType>>(new Set());
  const [pending, setPending] = useState<PendingUpload[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<Document | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pickTypeRef = useRef<DocumentType | null>(null);
  const bannerRef = useRef<HTMLDivElement>(null);

  const docs = documents.data ?? [];
  const existingTypes: ReadonlySet<DocumentType> = new Set(docs.map((d) => d.type));
  // 빠진 필수 문서 판정은 서버 값을 따른다. 지식 베이스를 아직 못 읽었으면 강조하지 않는다.
  const missingTypes: ReadonlySet<DocumentType> = new Set(kb.data?.missingDocumentTypes ?? []);
  const requiredTypes = DOCUMENT_TYPE_ORDER.filter((t) => documentTypeInfo[t].required);
  const optionalTypes = DOCUMENT_TYPE_ORDER.filter((t) => !documentTypeInfo[t].required);
  const requiredCount = requiredTypes.filter((t) => existingTypes.has(t)).length;
  const optionalCount = optionalTypes.filter((t) => existingTypes.has(t)).length;

  const startUpload = (type: DocumentType, file: File, onDone?: () => void) => {
    const invalid = validateFile(file, type, documentTypeInfo[type].label);
    if (invalid) {
      setNotice(invalid);
      return;
    }
    setNotice(null);
    setUploadingTypes((prev) => new Set(prev).add(type));
    upload.mutate(
      { type, file },
      {
        onSuccess: () => {
          build.reset();
          onDone?.();
        },
        onError: (error) => {
          if (hasErrorCode(error, "FILE_TOO_LARGE")) setNotice(`${file.name}: 파일당 20MB 이하만 올릴 수 있습니다.`);
          else if (hasErrorCode(error, "UNSUPPORTED_FILE_TYPE")) setNotice(`${file.name}: ${errorMessage(error)}`);
          else setNotice(`${file.name} 업로드 실패: ${errorMessage(error)}`);
        },
        onSettled: () =>
          setUploadingTypes((prev) => {
            const next = new Set(prev);
            next.delete(type);
            return next;
          }),
      },
    );
  };

  const onPickFile = (type: DocumentType) => {
    pickTypeRef.current = type;
    const input = fileInputRef.current;
    if (!input) return;
    input.accept = acceptAttribute(type);
    input.click();
  };

  const onDroppedFiles = (files: File[]) => {
    const errors: string[] = [];
    const accepted: PendingUpload[] = [];
    const known = new Set(existingTypes);
    for (const file of files) {
      const invalid = validateFile(file);
      if (invalid) {
        errors.push(invalid);
        continue;
      }
      const type = guessType(file, known);
      known.add(type);
      pendingSeq += 1;
      accepted.push({ id: `pending-${pendingSeq}`, file, type });
    }
    setNotice(errors.length ? errors.join("\n") : null);
    if (accepted.length) setPending((prev) => [...prev, ...accepted]);
  };

  const onDownload = async (doc: Document) => {
    try {
      const link = await fetchDocumentDownloadLink(doc.id);
      openLink(link.url);
    } catch (error) {
      setNotice(`다운로드 링크를 받지 못했습니다: ${errorMessage(error)}`);
    }
  };

  const onTemplate = async (type: DocumentType) => {
    try {
      const { blob, filename } = await fetchDocumentTemplate(type);
      saveBlob(blob, filename);
    } catch (error) {
      setNotice(`템플릿을 받지 못했습니다: ${errorMessage(error)}`);
    }
  };

  const onBuild = () => {
    setNotice(null);
    build.mutate(undefined, {
      onError: (error) => {
        // 409 MISSING_REQUIRED_DOCUMENTS는 다시 읽은 missingDocumentTypes로 배너를 그린다.
        if (hasErrorCode(error, "MISSING_REQUIRED_DOCUMENTS")) requestAnimationFrame(() => bannerRef.current?.focus());
        else setNotice(`지식 베이스 구축을 시작하지 못했습니다: ${errorMessage(error)}`);
      },
    });
  };

  // 빠진 필수 문서는 지식 베이스 조회 값을 따르고, 비어 있으면 마지막 409 응답의 missingDocumentTypes를 쓴다.
  // 409 기록은 문서를 새로 올리면 지운다 (startUpload에서 build.reset()).
  const kbMissing = kb.data?.missingDocumentTypes ?? [];
  const buildMissing = hasErrorCode(build.error, "MISSING_REQUIRED_DOCUMENTS") ? (build.error.problem?.missingDocumentTypes ?? []) : [];
  const missingList = kbMissing.length > 0 ? kbMissing : buildMissing;
  // 서버가 409로 거부했는데 빠진 목록을 알 수 없으면 배너 대신 서버 문구를 보여 준다.
  const unexplainedMissing =
    hasErrorCode(build.error, "MISSING_REQUIRED_DOCUMENTS") && missingList.length === 0 && !kb.isFetching
      ? build.error.message
      : null;
  const needsRetry = docs.filter((d) => d.status === "FAILED" || d.status === "SKIPPED");
  const shownNotice = notice ?? unexplainedMissing;
  const canBuild = kb.data?.canBuild === true && !building && !build.isPending;

  return (
    <>
      <PageHeader
        breadcrumb={[project.name, "문서 · 지식"]}
        title="테스트 기준 문서 등록"
        description="요구사항 명세서 · API 명세서 · 카탈로그를 등록하면 RAG 지식 베이스로 변환되어 시나리오 생성의 근거가 됩니다."
        actions={
          <>
            <Menu
              label="템플릿 종류"
              items={DOCUMENT_TYPE_ORDER.map((type) => ({
                key: type,
                label: documentTypeInfo[type].label,
                onSelect: () => void onTemplate(type),
              }))}
              trigger={({ open, toggle }) => (
                <Button icon={<Download aria-hidden className="size-4" />} aria-haspopup="menu" aria-expanded={open} onClick={toggle}>
                  템플릿 받기
                </Button>
              )}
            />
            <Button
              variant="primary"
              icon={building || build.isPending ? <Spinner className="size-4" /> : <DatabaseZap aria-hidden className="size-4" />}
              disabled={!canBuild}
              title={kb.data && !kb.data.canBuild && missingList.length > 0 ? "필수 문서를 모두 등록해야 구축할 수 있습니다" : undefined}
              onClick={onBuild}
            >
              {building ? "지식 베이스 구축 중" : "지식 베이스 구축"}
            </Button>
          </>
        }
      />

      <div className="mt-7 grid grid-cols-[minmax(0,1fr)_340px] gap-6">
        <div className="flex min-w-0 flex-col gap-7">
          {(missingList.length > 0 || shownNotice) && (
            <div className="flex flex-col gap-3">
              {missingList.length > 0 && <MissingDocumentsBanner ref={bannerRef} missing={missingList} />}
              {shownNotice && (
                <div role="alert" className="flex items-start gap-3 rounded-xl border border-danger-soft bg-surface px-4 py-3 text-xs text-danger">
                  <CircleAlert aria-hidden className="mt-px size-4 shrink-0" />
                  <p className="flex-1 whitespace-pre-line">{shownNotice}</p>
                  <button type="button" aria-label="알림 닫기" onClick={() => {
                      setNotice(null);
                      build.reset();
                    }}
                    className="text-muted hover:text-ink">
                    <X aria-hidden className="size-4" />
                  </button>
                </div>
              )}
            </div>
          )}

          <TargetUrlField key={project.id} project={project} />

          <section aria-labelledby="documents-title">
            <div className="flex items-baseline justify-between">
              <h2 id="documents-title" className="text-[13px] font-bold">
                기준 문서
              </h2>
              {documents.data && (
                <p className="text-xs text-muted">
                  필수 {requiredTypes.length}개 중 {requiredCount}개 등록 · 선택 {optionalCount}개
                </p>
              )}
            </div>
            <div className="mt-3">
              {documents.isPending ? (
                <div className="rounded-card border border-line bg-surface">
                  <LoadingBlock label="문서를 불러오는 중" />
                </div>
              ) : documents.isError ? (
                <div className="rounded-card border border-line bg-surface">
                  <ErrorBlock error={documents.error} onRetry={() => void documents.refetch()} />
                </div>
              ) : (
                <DocumentList
                  documents={docs}
                  missingTypes={missingTypes}
                  uploadingTypes={uploadingTypes}
                  onPickFile={onPickFile}
                  onDownload={(doc) => void onDownload(doc)}
                  onDelete={setDeleting}
                />
              )}
            </div>
            {needsRetry.length > 0 && !building && (
              <p className="mt-2 text-xs text-ink/70">
                인덱싱 실패·건너뜀 문서는 지식 베이스를 다시 구축하면 다시 처리합니다. 실패 원인이 된 문서는 새 버전을 올린 뒤 구축해 주세요.
              </p>
            )}
            <div className="mt-3">
              <UploadDropzone onFiles={onDroppedFiles} disabled={documents.isPending} />
              <PendingUploads
                items={pending}
                existingTypes={existingTypes}
                onChangeType={(id, type) => setPending((prev) => prev.map((p) => (p.id === id ? { ...p, type } : p)))}
                onRemove={(id) => setPending((prev) => prev.filter((p) => p.id !== id))}
                onUpload={(item) => {
                  setPending((prev) => prev.filter((p) => p.id !== item.id));
                  startUpload(item.type, item.file);
                }}
              />
            </div>
            <input
              ref={fileInputRef}
              type="file"
              hidden
              accept={ACCEPT_ATTRIBUTE}
              data-testid="row-file-input"
              onChange={(event) => {
                const file = event.target.files?.[0];
                const type = pickTypeRef.current;
                event.target.value = "";
                if (file && type) startUpload(type, file);
              }}
            />
          </section>
        </div>

        <aside className="flex flex-col divide-y divide-line-strong/30 [&>*]:py-6 [&>*:first-child]:pt-0">
          <ReadinessPanel kb={kb} />
          <KnowledgePreview kb={kb} />
          <ActivityList activities={activities} />
        </aside>
      </div>

      <Modal
        open={deleting !== null}
        title={deleting ? `${withObjectParticle(documentTypeInfo[deleting.type].label)} 삭제할까요?` : ""}
        onClose={() => setDeleting(null)}
        footer={
          <>
            <Button onClick={() => setDeleting(null)}>취소</Button>
            <Button
              variant="danger"
              disabled={remove.isPending}
              onClick={() => {
                if (!deleting) return;
                remove.mutate(deleting.id, {
                  onSuccess: () => setDeleting(null),
                  onError: (error) => {
                    setDeleting(null);
                    setNotice(`삭제하지 못했습니다: ${errorMessage(error)}`);
                  },
                });
              }}
            >
              {remove.isPending ? "삭제 중" : "삭제"}
            </Button>
          </>
        }
        description={
          deleting && (
            <>
              <span className="font-mono text-ink">{deleting.originalFilename}</span>
              <br />
              삭제하면 지식 베이스를 다시 구축해야 합니다.
            </>
          )
        }
      />
    </>
  );
}
