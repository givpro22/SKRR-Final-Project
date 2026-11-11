import { ChevronRight, Sparkles } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTestRequests } from "@/api/queries/requests";
import type { TestRequest } from "@/api/types";
import { useProjectContext } from "@/app/useProjectContext";
import { Badge } from "@/components/Badge";
import { Button } from "@/components/Button";
import { PageHeader } from "@/components/PageHeader";
import { EmptyBlock, ErrorBlock, LoadingBlock } from "@/components/StateViews";
import { formatClock } from "@/lib/format";
import { requestStatusView } from "./labels";
import { RequestFlowModal } from "./RequestFlowModal";

const dateFormatter = new Intl.DateTimeFormat("ko-KR", { month: "2-digit", day: "2-digit" });

/** 테스트 요청 목록. 캡처가 없어 다른 화면과 같은 스타일로 최소 구현했다 (디자인 확인 필요) */
export function RequestsPage() {
  const { project } = useProjectContext();
  const navigate = useNavigate();
  const requests = useTestRequests(project.id);
  const [flow, setFlow] = useState<{ requestId: string | null } | null>(null);

  const open = (request: TestRequest) => {
    if (request.status === "GENERATED") navigate(`/projects/${project.id}/requests/${request.id}/scenarios`);
    else setFlow({ requestId: request.id }); // 진행 중이거나 선택 대기·실패면 모달에서 이어서 본다
  };

  return (
    <>
      <PageHeader
        breadcrumb={[project.name, "테스트 요청"]}
        title="테스트 요청"
        description="자연어로 요청하면 AI가 명세를 근거로 시나리오와 테스트 케이스를 만듭니다."
        actions={
          <Button variant="primary" icon={<Sparkles aria-hidden className="size-4" />} onClick={() => setFlow({ requestId: null })}>
            테스트 시나리오 생성
          </Button>
        }
      />
      <div className="mt-8 overflow-hidden rounded-card border border-line bg-surface">
        {requests.isPending ? (
          <LoadingBlock label="요청을 불러오는 중" />
        ) : requests.isError ? (
          <ErrorBlock error={requests.error} onRetry={() => void requests.refetch()} />
        ) : requests.data.items.length === 0 ? (
          <EmptyBlock>
            아직 테스트 요청이 없습니다.
            <Button size="sm" className="mt-2" onClick={() => setFlow({ requestId: null })}>
              첫 요청 만들기
            </Button>
          </EmptyBlock>
        ) : (
          <ul>
            {requests.data.items.map((request) => {
              const view = requestStatusView[request.status];
              return (
                <li key={request.id} className="border-b border-line last:border-b-0">
                  <button
                    type="button"
                    onClick={() => open(request)}
                    className="flex w-full items-center gap-4 px-5 py-3.5 text-left hover:bg-accent-row"
                  >
                    <span className="w-[72px] shrink-0 font-mono text-xs text-muted">{request.code}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold">{request.selectedText ?? request.rawText}</span>
                      {request.selectedText && request.selectedText !== request.rawText && (
                        <span className="block truncate text-xs text-muted">입력: {request.rawText}</span>
                      )}
                    </span>
                    {request.status === "GENERATED" && (
                      <span className="shrink-0 text-xs text-ink/70">
                        시나리오 {request.scenarioCount} · 케이스 {request.testCaseCount}
                      </span>
                    )}
                    <Badge tone={view.tone}>{view.label}</Badge>
                    <time dateTime={request.createdAt} className="w-[86px] shrink-0 text-right font-mono text-xs text-muted">
                      {dateFormatter.format(new Date(request.createdAt))} {formatClock(request.createdAt)}
                    </time>
                    <ChevronRight aria-hidden className="size-4 shrink-0 text-muted" />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      {flow && (
        <RequestFlowModal
          projectId={project.id}
          resumeRequestId={flow.requestId}
          onClose={() => setFlow(null)}
          onDone={(id) => {
            setFlow(null);
            navigate(`/projects/${project.id}/requests/${id}/scenarios`);
          }}
        />
      )}
    </>
  );
}
