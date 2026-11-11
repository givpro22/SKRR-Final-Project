import { Navigate } from "react-router-dom";
import { useTestRequests } from "@/api/queries/requests";
import { useProjectContext } from "@/app/useProjectContext";
import { PageHeader } from "@/components/PageHeader";
import { EmptyBlock, ErrorBlock, LoadingBlock } from "@/components/StateViews";
import { Link } from "react-router-dom";

/** 사이드바 "시나리오 승인": 가장 최근 GENERATED 요청의 UI-02-5로 보낸다 (C1 frontend 메모) */
export function LatestScenariosPage() {
  const { project } = useProjectContext();
  const requests = useTestRequests(project.id);
  if (requests.isPending) return <LoadingBlock className="mt-24" />;
  if (requests.isError) return <ErrorBlock className="mt-24" error={requests.error} onRetry={() => void requests.refetch()} />;
  // 목록은 최신순이다. 순서를 확신할 수 없어 생성 시각으로 한 번 더 정렬한다.
  const latest = requests.data.items
    .filter((r) => r.status === "GENERATED")
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  if (latest) return <Navigate to={`/projects/${project.id}/requests/${latest.id}/scenarios`} replace />;
  return (
    <>
      <PageHeader breadcrumb={[project.name, "시나리오 승인"]} title="시나리오 승인" />
      <div className="mt-8 rounded-card border border-line bg-surface">
        <EmptyBlock>
          승인할 시나리오가 아직 없습니다.
          <Link to={`/projects/${project.id}/requests`} className="text-accent hover:underline">
            테스트 요청에서 시나리오를 만들어 주세요
          </Link>
        </EmptyBlock>
      </div>
    </>
  );
}
