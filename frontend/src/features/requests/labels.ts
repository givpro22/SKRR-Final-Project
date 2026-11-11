import type { TestRequestStatus } from "@/api/types";
import type { Tone } from "@/components/Badge";

// state-machines.md TestRequest 표의 "화면" 열을 짧은 배지 문구로 옮겼다 (캡처에 없음, 디자인 확인 필요).
export const requestStatusView: Record<TestRequestStatus, { label: string; tone: Tone }> = {
  REFINING: { label: "후보 정리 중", tone: "accent" },
  AWAITING_SELECTION: { label: "후보 선택 대기", tone: "warning" },
  GENERATING: { label: "시나리오 생성 중", tone: "accent" },
  GENERATED: { label: "생성 완료", tone: "success" },
  FAILED: { label: "실패", tone: "danger" },
};
