import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, unwrap, unwrapEmpty } from "../client";
import type { Document, DocumentType } from "../types";
import { POLL_INTERVAL_MS, queryKeys } from "./keys";

/**
 * 서버가 처리 중인 문서 상태. 이 상태가 있으면 2초 간격으로 다시 읽는다.
 * UPLOADED는 지식 베이스 구축을 눌러야 INDEXING이 되므로 조회 대상이 아니다 (백엔드 동작 확인, 2026-11-10).
 */
export function isDocumentProcessing(doc: Pick<Document, "status">): boolean {
  return doc.status === "INDEXING";
}

export function useDocuments(projectId: string, options: { poll?: boolean } = {}) {
  return useQuery({
    queryKey: queryKeys.documents(projectId),
    queryFn: () => unwrap(api.GET("/projects/{projectId}/documents", { params: { path: { projectId } } })),
    select: (data) => data.items,
    refetchInterval: (query) =>
      options.poll || query.state.data?.items.some(isDocumentProcessing) ? POLL_INTERVAL_MS : false,
  });
}

function useInvalidateProjectDocuments(projectId: string) {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.documents(projectId) });
    void queryClient.invalidateQueries({ queryKey: queryKeys.knowledgeBase(projectId) });
    void queryClient.invalidateQueries({ queryKey: queryKeys.activities(projectId) });
  };
}

export function useUploadDocument(projectId: string) {
  const invalidate = useInvalidateProjectDocuments(projectId);
  return useMutation({
    mutationFn: ({ type, file }: { type: DocumentType; file: File }) =>
      unwrap(
        api.POST("/projects/{projectId}/documents", {
          params: { path: { projectId } },
          body: { type, file },
          bodySerializer: (body) => {
            const form = new FormData();
            form.append("type", body.type);
            form.append("file", body.file, file.name);
            return form;
          },
        }),
      ),
    onSettled: invalidate,
  });
}

export function useDeleteDocument(projectId: string) {
  const invalidate = useInvalidateProjectDocuments(projectId);
  return useMutation({
    mutationFn: (documentId: string) =>
      unwrapEmpty(api.DELETE("/documents/{documentId}", { params: { path: { documentId } } })),
    onSettled: invalidate,
  });
}

export function fetchDocumentDownloadLink(documentId: string) {
  return unwrap(api.GET("/documents/{documentId}/download-link", { params: { path: { documentId } } }));
}

/** 템플릿 파일을 받아 파일 이름과 함께 돌려준다. */
export async function fetchDocumentTemplate(documentType: DocumentType): Promise<{ blob: Blob; filename: string }> {
  const result = await api.GET("/document-templates/{documentType}", {
    params: { path: { documentType } },
    parseAs: "blob",
  });
  const blob = await unwrap(Promise.resolve(result));
  const disposition = result.response.headers.get("content-disposition") ?? "";
  const match = /filename\*=UTF-8''([^;]+)|filename="?([^";]+)"?/i.exec(disposition);
  const encoded = match?.[1];
  const plain = match?.[2];
  const filename = encoded ? decodeURIComponent(encoded) : (plain ?? `${documentType.toLowerCase()}-template`);
  return { blob, filename };
}
