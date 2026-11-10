import { Link, Outlet, useParams } from "react-router-dom";
import { useProject } from "@/api/queries/projects";
import { ErrorBlock, LoadingBlock } from "@/components/StateViews";
import { hasErrorCode } from "@/api/errors";
import { Sidebar } from "./Sidebar";
import type { ProjectContext } from "./useProjectContext";

export function AppLayout() {
  const { projectId = "" } = useParams();
  const project = useProject(projectId);

  let content;
  if (project.isPending) {
    content = <LoadingBlock className="mt-24" label="프로젝트를 불러오는 중" />;
  } else if (project.isError) {
    content = hasErrorCode(project.error, "RESOURCE_NOT_FOUND") ? (
      <div className="mt-24 text-center text-[13px]">
        <p className="font-semibold">프로젝트를 찾을 수 없습니다.</p>
        <Link to="/" className="mt-2 inline-block text-accent hover:underline">
          프로젝트 목록으로
        </Link>
      </div>
    ) : (
      <ErrorBlock className="mt-24" error={project.error} onRetry={() => void project.refetch()} />
    );
  } else {
    const context: ProjectContext = { project: project.data };
    content = <Outlet context={context} />;
  }

  return (
    <div className="flex min-h-full">
      <Sidebar projectId={projectId} />
      <main className="min-w-0 flex-1 px-10 pt-8 pb-16">{content}</main>
    </div>
  );
}
