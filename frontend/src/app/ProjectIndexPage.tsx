import { useState, type FormEvent } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useCreateProject, useProjects } from "@/api/queries/projects";
import { ApiError, errorMessage } from "@/api/errors";
import { Button } from "@/components/Button";
import { ErrorBlock, LoadingBlock } from "@/components/StateViews";

/** 첫 화면: 첫 프로젝트의 문서 등록으로 보낸다. 프로젝트가 없으면 만들게 한다. */
export function ProjectIndexPage() {
  const projects = useProjects();
  if (projects.isPending) return <LoadingBlock className="mt-24" label="프로젝트를 불러오는 중" />;
  if (projects.isError) return <ErrorBlock className="mt-24" error={projects.error} onRetry={() => void projects.refetch()} />;
  const first = projects.data[0];
  if (first) return <Navigate to={`/projects/${first.id}/documents`} replace />;
  return <CreateProjectForm />;
}

function CreateProjectForm() {
  const create = useCreateProject();
  const navigate = useNavigate();
  const [name, setName] = useState("");

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    create.mutate(
      { name: name.trim() },
      { onSuccess: (project) => navigate(`/projects/${project.id}/documents`) },
    );
  };

  const nameError = create.error instanceof ApiError ? create.error.fieldError("name") : undefined;

  return (
    <div className="flex min-h-full items-center justify-center p-10">
      <form onSubmit={onSubmit} className="w-full max-w-[420px] rounded-card border border-line bg-surface p-8">
        <h1 className="text-xl font-bold">첫 프로젝트 만들기</h1>
        <p className="mt-2 text-[13px] text-muted">테스트할 대상 사이트의 이름을 정해 주세요.</p>
        <label className="mt-6 block text-[13px] font-semibold" htmlFor="project-name">
          프로젝트 이름
        </label>
        <input
          id="project-name"
          value={name}
          maxLength={100}
          onChange={(event) => setName(event.target.value)}
          className="mt-2 h-11 w-full rounded-xl border border-line-strong bg-surface px-3 text-sm outline-none focus:border-focus"
        />
        {(nameError || (create.isError && !nameError)) && (
          <p role="alert" className="mt-2 text-xs text-danger">
            {nameError ?? errorMessage(create.error)}
          </p>
        )}
        <Button type="submit" variant="primary" className="mt-6 w-full" disabled={!name.trim() || create.isPending}>
          {create.isPending ? "만드는 중" : "만들기"}
        </Button>
      </form>
    </div>
  );
}
