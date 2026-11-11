import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, unwrap } from "../client";
import type { RunStatus } from "../types";
import { queryKeys } from "./keys";

export const TERMINAL_RUN_STATUSES = ["PASSED", "FAILED", "CANCELLED", "ERROR"] as const satisfies readonly RunStatus[];

export function isRunFinished(status: RunStatus): boolean {
  return (TERMINAL_RUN_STATUSES as readonly RunStatus[]).includes(status);
}

export function useRuns(projectId: string) {
  return useQuery({
    queryKey: queryKeys.runs(projectId),
    queryFn: () =>
      unwrap(api.GET("/projects/{projectId}/runs", { params: { path: { projectId }, query: { limit: 20 } } })),
  });
}

/** UI-03 첫 진입 스냅샷. 이후 변화는 SSE로 받으므로 자동으로 다시 읽지 않는다 */
export function useRunSnapshot(runId: string) {
  return useQuery({
    queryKey: queryKeys.run(runId),
    queryFn: () => unwrap(api.GET("/runs/{runId}", { params: { path: { runId } } })),
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
}

export function useStartRun(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ testRequestId, scenarioIds }: { testRequestId: string; scenarioIds: string[] }) =>
      unwrap(api.POST("/test-requests/{testRequestId}/runs", { params: { path: { testRequestId } }, body: { scenarioIds } })),
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.runs(projectId) }),
  });
}

export function useCancelRun(runId: string) {
  return useMutation({
    mutationFn: () => unwrap(api.POST("/runs/{runId}/cancel", { params: { path: { runId } } })),
  });
}

/** 저장된 로그를 끝까지 읽는다. 화면은 최근 1000줄만 그리므로 그만큼만 남긴다 */
export async function fetchRunLogs(runId: string, keep = 1000) {
  const items: Awaited<ReturnType<typeof fetchLogPage>>["items"] = [];
  let afterSeq: number | undefined = undefined;
  for (let page = 0; page < 50; page += 1) {
    const result: Awaited<ReturnType<typeof fetchLogPage>> = await fetchLogPage(runId, afterSeq);
    items.push(...result.items);
    if (items.length > keep) items.splice(0, items.length - keep);
    if (result.nextAfterSeq == null || result.items.length === 0) break;
    afterSeq = result.nextAfterSeq;
  }
  return items;
}

function fetchLogPage(runId: string, afterSeq?: number) {
  return unwrap(
    api.GET("/runs/{runId}/logs", {
      params: { path: { runId }, query: { limit: 200, ...(afterSeq !== undefined ? { afterSeq } : {}) } },
    }),
  );
}

export function fetchRunApiCalls(runId: string) {
  return unwrap(api.GET("/runs/{runId}/api-calls", { params: { path: { runId }, query: { limit: 50 } } }));
}

export function useCaseSpec(caseResultId: string | null) {
  return useQuery({
    queryKey: queryKeys.caseSpec(caseResultId ?? ""),
    queryFn: () =>
      unwrap(api.GET("/case-results/{caseResultId}/spec", { params: { path: { caseResultId: caseResultId ?? "" } } })),
    enabled: caseResultId !== null,
    retry: false,
  });
}

export function fetchCaseResult(caseResultId: string) {
  return unwrap(api.GET("/case-results/{caseResultId}", { params: { path: { caseResultId } } }));
}

/** 실행 증거(스크린샷 등) 링크. 링크는 만료되므로 4분이 지나면 새로 받는다 */
export function useArtifactLink(artifactId: string | null) {
  return useQuery({
    queryKey: queryKeys.artifactLink(artifactId ?? ""),
    queryFn: () =>
      unwrap(api.GET("/artifacts/{artifactId}/download-link", { params: { path: { artifactId: artifactId ?? "" } } })),
    enabled: artifactId !== null,
    staleTime: 4 * 60_000,
  });
}

export function fetchArtifactLink(artifactId: string) {
  return unwrap(api.GET("/artifacts/{artifactId}/download-link", { params: { path: { artifactId } } }));
}
