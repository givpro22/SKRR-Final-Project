export const queryKeys = {
  me: ["me"] as const,
  projects: ["projects"] as const,
  project: (projectId: string) => ["projects", projectId] as const,
  documents: (projectId: string) => ["projects", projectId, "documents"] as const,
  knowledgeBase: (projectId: string) => ["projects", projectId, "knowledge-base"] as const,
  activities: (projectId: string) => ["projects", projectId, "activities"] as const,
};

/** 생성·인덱싱 중 상태의 조회 간격 (skrr-frontend 규칙: 2초) */
export const POLL_INTERVAL_MS = 2000;
