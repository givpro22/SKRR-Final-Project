import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, unwrap } from "../client";
import type { Scenario, ScenarioStatus, ScenarioUpdate, TestCase, TestCaseUpdate } from "../types";
import { POLL_INTERVAL_MS, queryKeys } from "./keys";
import { isRequestProcessing } from "./requests";

/** 생성·재생성 중인 시나리오 상태 */
export function isScenarioProcessing(status: ScenarioStatus): boolean {
  return status === "GENERATING" || status === "GUARD_RETRY";
}

export function useScenarioList(testRequestId: string) {
  return useQuery({
    queryKey: queryKeys.scenarios(testRequestId),
    queryFn: () =>
      unwrap(api.GET("/test-requests/{testRequestId}/scenarios", { params: { path: { testRequestId } } })),
    refetchInterval: (query) => {
      const data = query.state.data;
      if (!data) return false;
      const busy =
        isRequestProcessing(data.testRequest.status) || data.items.some((s) => isScenarioProcessing(s.status));
      return busy ? POLL_INTERVAL_MS : false;
    },
  });
}

/** 시나리오 하나가 바뀌면 목록(집계 포함)을 다시 읽는다. 승인 해제 같은 서버 쪽 변화를 그대로 보이기 위해서다. */
function useRefreshScenarios(testRequestId: string) {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: queryKeys.scenarios(testRequestId) });
}

export function useUpdateScenario(testRequestId: string) {
  const refresh = useRefreshScenarios(testRequestId);
  return useMutation({
    mutationFn: ({ scenarioId, body }: { scenarioId: string; body: ScenarioUpdate }) =>
      unwrap(api.PATCH("/scenarios/{scenarioId}", { params: { path: { scenarioId } }, body })),
    onSettled: refresh,
  });
}

type ScenarioAction = "approve" | "reject";

export function useScenarioDecision(testRequestId: string) {
  const refresh = useRefreshScenarios(testRequestId);
  return useMutation({
    mutationFn: ({ scenarioId, action }: { scenarioId: string; action: ScenarioAction }): Promise<Scenario> =>
      action === "approve"
        ? unwrap(api.POST("/scenarios/{scenarioId}/approve", { params: { path: { scenarioId } } }))
        : unwrap(api.POST("/scenarios/{scenarioId}/reject", { params: { path: { scenarioId } } })),
    onSettled: refresh,
  });
}

export function useRegenerateScenario(testRequestId: string) {
  const refresh = useRefreshScenarios(testRequestId);
  return useMutation({
    mutationFn: ({ scenarioId, feedback }: { scenarioId: string; feedback: string }) =>
      unwrap(
        api.POST("/scenarios/{scenarioId}/regenerate", {
          params: { path: { scenarioId } },
          body: feedback.trim() ? { feedback: feedback.trim() } : {},
        }),
      ),
    onSettled: refresh,
  });
}

export function useTestCase(testCaseId: string | null, initialData?: TestCase) {
  return useQuery({
    queryKey: queryKeys.testCase(testCaseId ?? ""),
    queryFn: () => unwrap(api.GET("/test-cases/{testCaseId}", { params: { path: { testCaseId: testCaseId ?? "" } } })),
    enabled: testCaseId !== null,
    initialData,
    // 목록에서 받은 값으로 먼저 그리고, 열 때마다 최신 값을 다시 읽는다
    initialDataUpdatedAt: 0,
  });
}

export function useUpdateTestCase(testRequestId: string) {
  const queryClient = useQueryClient();
  const refresh = useRefreshScenarios(testRequestId);
  return useMutation({
    mutationFn: ({ testCaseId, body }: { testCaseId: string; body: TestCaseUpdate }) =>
      unwrap(api.PATCH("/test-cases/{testCaseId}", { params: { path: { testCaseId } }, body })),
    onSuccess: (testCase) => queryClient.setQueryData(queryKeys.testCase(testCase.id), testCase),
    onSettled: refresh,
  });
}
