import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, unwrap } from "../client";
import { POLL_INTERVAL_MS, queryKeys } from "./keys";

export function useKnowledgeBase(projectId: string, options: { pollWhileIndexing?: boolean } = {}) {
  return useQuery({
    queryKey: queryKeys.knowledgeBase(projectId),
    queryFn: () => unwrap(api.GET("/projects/{projectId}/knowledge-base", { params: { path: { projectId } } })),
    refetchInterval: (query) =>
      query.state.data?.status === "BUILDING" || options.pollWhileIndexing ? POLL_INTERVAL_MS : false,
  });
}

export function useBuildKnowledgeBase(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      unwrap(api.POST("/projects/{projectId}/knowledge-base/build", { params: { path: { projectId } } })),
    onSuccess: (kb) => queryClient.setQueryData(queryKeys.knowledgeBase(projectId), kb),
    onSettled: () => {
      // 409 MISSING_REQUIRED_DOCUMENTS여도 최신 missingDocumentTypes로 배너를 다시 그린다.
      void queryClient.invalidateQueries({ queryKey: queryKeys.knowledgeBase(projectId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.documents(projectId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.activities(projectId) });
    },
  });
}
