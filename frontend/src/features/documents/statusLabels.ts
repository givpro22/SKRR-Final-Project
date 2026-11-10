import type { DocumentStatus, KnowledgeBaseStatus, TargetUrlStatus } from "@/api/types";
import type { Tone } from "@/components/Badge";

export interface StatusView {
  label: string;
  tone: Tone;
}

// 문구는 docs/contracts/state-machines.md의 Document 표시를 따른다.
export function documentStatusView(status: DocumentStatus, indexProgress: number): StatusView {
  const views: Record<DocumentStatus, StatusView> = {
    UPLOADED: { label: "구축 대기", tone: "muted" },
    INDEXING: { label: `인덱싱 중 ${indexProgress}%`, tone: "accent" },
    INDEXED: { label: "인덱싱 완료", tone: "success" },
    REGISTERED: { label: "등록됨", tone: "success" },
    FAILED: { label: "인덱싱 실패", tone: "danger" },
    SKIPPED: { label: "건너뜀", tone: "warning" },
  };
  return views[status];
}

// 지식 베이스 상태 문구는 캡처에 없어 같은 어휘로 정했다 (디자인 확인 필요).
export const knowledgeBaseStatusView: Record<KnowledgeBaseStatus, StatusView> = {
  NOT_BUILT: { label: "미구축", tone: "muted" },
  BUILDING: { label: "구축 중", tone: "accent" },
  READY: { label: "최신", tone: "success" },
  STALE: { label: "재구축 필요", tone: "warning" },
  FAILED: { label: "구축 실패", tone: "danger" },
};

export const targetStatusView: Record<TargetUrlStatus, StatusView> = {
  UNVERIFIED: { label: "연결 확인 전", tone: "muted" },
  CHECKING: { label: "연결 확인 중", tone: "accent" },
  // ADR-019: HTTP GET 확인이므로 "Playwright 연결 확인"이 아니라 "연결 확인"
  REACHABLE: { label: "연결 확인", tone: "success" },
  UNREACHABLE: { label: "연결 실패", tone: "danger" },
};
