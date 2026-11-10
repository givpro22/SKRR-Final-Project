import { useOutletContext } from "react-router-dom";
import type { Project } from "@/api/types";

export interface ProjectContext {
  project: Project;
}

/** AppLayout이 불러온 현재 프로젝트 */
export function useProjectContext() {
  return useOutletContext<ProjectContext>();
}
