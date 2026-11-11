import { Link, Navigate } from "react-router-dom";
import { isRunFinished, useRuns } from "@/api/queries/runs";
import { useProjectContext } from "@/app/useProjectContext";
import { PageHeader } from "@/components/PageHeader";
import { EmptyBlock, ErrorBlock, LoadingBlock } from "@/components/StateViews";

/** 사이드바 "실행 모니터": 진행 중인 실행, 없으면 가장 최근 실행의 UI-03으로 보낸다 */
export function LatestRunPage() {
  const { project } = useProjectContext();
  const runs = useRuns(project.id);
  if (runs.isPending) return <LoadingBlock className="mt-24" />;
  if (runs.isError) return <ErrorBlock className="mt-24" error={runs.error} onRetry={() => void runs.refetch()} />;
  const sorted = [...runs.data.items].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const target = sorted.find((r) => !isRunFinished(r.status)) ?? sorted[0];
  if (target) return <Navigate to={`/projects/${project.id}/runs/${target.id}/monitor`} replace />;
  return (
    <>
      <PageHeader breadcrumb={[project.name, "실행 모니터"]} title="실행 모니터" />
      <div className="mt-8 rounded-card border border-line bg-surface">
        <EmptyBlock>
          아직 실행한 테스트가 없습니다.
          <Link to={`/projects/${project.id}/scenarios`} className="text-accent hover:underline">
            시나리오를 승인하고 실행해 주세요
          </Link>
        </EmptyBlock>
      </div>
    </>
  );
}
