import { Link, Navigate } from "react-router-dom";
import { isRunFinished, useRuns } from "@/api/queries/runs";
import { useProjectContext } from "@/app/useProjectContext";
import { PageHeader } from "@/components/PageHeader";
import { EmptyBlock, ErrorBlock, LoadingBlock } from "@/components/StateViews";

/** 사이드바 "리포트": 가장 최근에 끝난 실행의 UI-04로 보낸다 */
export function LatestReportPage() {
  const { project } = useProjectContext();
  const runs = useRuns(project.id);
  if (runs.isPending) return <LoadingBlock className="mt-24" />;
  if (runs.isError) return <ErrorBlock className="mt-24" error={runs.error} onRetry={() => void runs.refetch()} />;
  const latest = [...runs.data.items].filter((r) => isRunFinished(r.status)).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  if (latest) return <Navigate to={`/projects/${project.id}/runs/${latest.id}/report`} replace />;
  return (
    <>
      <PageHeader breadcrumb={[project.name, "리포트"]} title="테스트 결과 리포트" />
      <div className="mt-8 rounded-card border border-line bg-surface">
        <EmptyBlock>
          아직 끝난 실행이 없습니다.
          <Link to={`/projects/${project.id}/monitor`} className="text-accent hover:underline">
            실행 모니터 보기
          </Link>
        </EmptyBlock>
      </div>
    </>
  );
}
