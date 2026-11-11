import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, unwrap } from "../client";
import type { AnalysisStatus, RunReport } from "../types";
import { POLL_INTERVAL_MS, queryKeys } from "./keys";

/** 원인 분석이 아직 끝나지 않은 상태. 이 상태면 2초 간격으로 다시 읽는다 (C1 M4 메모) */
export function isAnalysisPending(status: AnalysisStatus): boolean {
  return status === "PENDING" || status === "RUNNING";
}

export function useRunReport(runId: string) {
  return useQuery({
    queryKey: queryKeys.report(runId),
    queryFn: () => unwrap(api.GET("/runs/{runId}/report", { params: { path: { runId } } })),
  });
}

export function useCaseResult(caseResultId: string | null) {
  return useQuery({
    queryKey: queryKeys.caseResult(caseResultId ?? ""),
    queryFn: () =>
      unwrap(api.GET("/case-results/{caseResultId}", { params: { path: { caseResultId: caseResultId ?? "" } } })),
    enabled: caseResultId !== null,
    refetchInterval: (query) => (query.state.data && isAnalysisPending(query.state.data.analysisStatus) ? POLL_INTERVAL_MS : false),
  });
}

export function useRerunRun(runId: string, projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (caseResultIds: string[]) =>
      unwrap(
        api.POST("/runs/{runId}/rerun", {
          params: { path: { runId } },
          body: caseResultIds.length ? { caseResultIds } : {},
        }),
      ),
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.runs(projectId) }),
  });
}

export type { RunReport };
