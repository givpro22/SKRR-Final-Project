import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, unwrap } from "../client";
import type { SelectionRequest, TestRequest, TestRequestStatus } from "../types";
import { POLL_INTERVAL_MS, queryKeys } from "./keys";

/** 서버가 처리 중인 요청 상태. 이 상태면 2초 간격으로 다시 읽는다. */
export function isRequestProcessing(status: TestRequestStatus): boolean {
  return status === "REFINING" || status === "GENERATING";
}

const REQUEST_LIST_LIMIT = 50;

export function useTestRequests(projectId: string) {
  return useQuery({
    queryKey: queryKeys.testRequests(projectId),
    queryFn: () =>
      unwrap(
        api.GET("/projects/{projectId}/test-requests", {
          params: { path: { projectId }, query: { limit: REQUEST_LIST_LIMIT } },
        }),
      ),
    refetchInterval: (query) =>
      query.state.data?.items.some((r) => isRequestProcessing(r.status)) ? POLL_INTERVAL_MS : false,
  });
}

export function useTestRequest(testRequestId: string | null) {
  return useQuery({
    queryKey: queryKeys.testRequest(testRequestId ?? ""),
    queryFn: () =>
      unwrap(api.GET("/test-requests/{testRequestId}", { params: { path: { testRequestId: testRequestId ?? "" } } })),
    enabled: testRequestId !== null,
    refetchInterval: (query) => (query.state.data && isRequestProcessing(query.state.data.status) ? POLL_INTERVAL_MS : false),
  });
}

function useStoreRequest(projectId: string) {
  const queryClient = useQueryClient();
  return (request: TestRequest) => {
    queryClient.setQueryData(queryKeys.testRequest(request.id), request);
    void queryClient.invalidateQueries({ queryKey: queryKeys.testRequests(projectId) });
  };
}

export function useCreateTestRequest(projectId: string) {
  const store = useStoreRequest(projectId);
  return useMutation({
    mutationFn: (text: string) =>
      unwrap(api.POST("/projects/{projectId}/test-requests", { params: { path: { projectId } }, body: { text } })),
    onSuccess: store,
  });
}

export function useSelectRefinedRequest(projectId: string) {
  const store = useStoreRequest(projectId);
  return useMutation({
    mutationFn: ({ testRequestId, selection }: { testRequestId: string; selection: SelectionRequest }) =>
      unwrap(
        api.POST("/test-requests/{testRequestId}/selection", {
          params: { path: { testRequestId } },
          body: selection,
        }),
      ),
    onSuccess: store,
  });
}
