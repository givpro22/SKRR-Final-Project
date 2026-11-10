import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, unwrap } from "../client";
import type { Project, ProjectCreate, ProjectUpdate } from "../types";
import { POLL_INTERVAL_MS, queryKeys } from "./keys";

export function useCurrentUser() {
  return useQuery({
    queryKey: queryKeys.me,
    queryFn: () => unwrap(api.GET("/me")),
    staleTime: 5 * 60_000,
  });
}

export function useProjects() {
  return useQuery({
    queryKey: queryKeys.projects,
    queryFn: () => unwrap(api.GET("/projects")),
    select: (data) => data.items,
  });
}

export function useProject(projectId: string) {
  return useQuery({
    queryKey: queryKeys.project(projectId),
    queryFn: () => unwrap(api.GET("/projects/{projectId}", { params: { path: { projectId } } })),
    refetchInterval: (query) => (query.state.data?.targetUrlStatus === "CHECKING" ? POLL_INTERVAL_MS : false),
  });
}

export function useCreateProject() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: ProjectCreate) => unwrap(api.POST("/projects", { body })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.projects }),
  });
}

export function useUpdateProject(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: ProjectUpdate) =>
      unwrap(api.PATCH("/projects/{projectId}", { params: { path: { projectId } }, body })),
    onSuccess: (project) => {
      queryClient.setQueryData(queryKeys.project(projectId), project);
      void queryClient.invalidateQueries({ queryKey: queryKeys.projects });
      void queryClient.invalidateQueries({ queryKey: queryKeys.knowledgeBase(projectId) });
    },
  });
}

export function useVerifyTargetSite(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      unwrap(api.POST("/projects/{projectId}/target-verification", { params: { path: { projectId } } })),
    onSuccess: (result) => {
      // 서버는 같은 값을 Project에 저장한다. 다시 읽기 전에도 결과를 바로 보여 준다.
      queryClient.setQueryData<Project>(queryKeys.project(projectId), (project) =>
        project && {
          ...project,
          targetUrlStatus: result.status,
          targetCheckedAt: result.checkedAt,
          targetCheckStatusCode: result.statusCode ?? null,
          targetCheckMessage: result.message ?? null,
        },
      );
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.project(projectId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.knowledgeBase(projectId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.activities(projectId) });
    },
  });
}

export function useActivities(projectId: string, options: { limit: number; poll: boolean }) {
  return useQuery({
    queryKey: [...queryKeys.activities(projectId), options.limit],
    queryFn: () =>
      unwrap(
        api.GET("/projects/{projectId}/activities", {
          params: { path: { projectId }, query: { limit: options.limit } },
        }),
      ),
    select: (data) => data.items,
    refetchInterval: options.poll ? POLL_INTERVAL_MS : false,
  });
}
