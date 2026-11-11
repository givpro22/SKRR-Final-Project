export const queryKeys = {
  me: ["me"] as const,
  projects: ["projects"] as const,
  project: (projectId: string) => ["projects", projectId] as const,
  documents: (projectId: string) => ["projects", projectId, "documents"] as const,
  knowledgeBase: (projectId: string) => ["projects", projectId, "knowledge-base"] as const,
  activities: (projectId: string) => ["projects", projectId, "activities"] as const,
  testRequests: (projectId: string) => ["projects", projectId, "test-requests"] as const,
  testRequest: (testRequestId: string) => ["test-requests", testRequestId] as const,
  scenarios: (testRequestId: string) => ["test-requests", testRequestId, "scenarios"] as const,
  testCase: (testCaseId: string) => ["test-cases", testCaseId] as const,
  runs: (projectId: string) => ["projects", projectId, "runs"] as const,
  run: (runId: string) => ["runs", runId] as const,
  caseSpec: (caseResultId: string) => ["case-results", caseResultId, "spec"] as const,
  caseResult: (caseResultId: string) => ["case-results", caseResultId] as const,
  artifactLink: (artifactId: string) => ["artifacts", artifactId, "link"] as const,
  report: (runId: string) => ["runs", runId, "report"] as const,
};

/** 생성·인덱싱 중 상태의 조회 간격 (skrr-frontend 규칙: 2초). 테스트에서만 짧게 줄여 흐름을 빨리 확인한다 */
export const POLL_INTERVAL_MS = import.meta.env.MODE === "test" ? 100 : 2000;
