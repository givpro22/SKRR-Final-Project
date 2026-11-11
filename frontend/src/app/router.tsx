import { createBrowserRouter, createMemoryRouter, Navigate, type RouteObject } from "react-router-dom";
import { DocumentsPage } from "@/features/documents/DocumentsPage";
import { RequestsPage } from "@/features/requests/RequestsPage";
import { LatestReportPage } from "@/features/reports/LatestReportPage";
import { ReportPage } from "@/features/reports/ReportPage";
import { LatestRunPage } from "@/features/runs/LatestRunPage";
import { RunMonitorPage } from "@/features/runs/RunMonitorPage";
import { LatestScenariosPage } from "@/features/scenarios/LatestScenariosPage";
import { ScenariosPage } from "@/features/scenarios/ScenariosPage";
import { AppLayout } from "./AppLayout";
import { NotFoundPage } from "./NotFoundPage";
import { ProjectIndexPage } from "./ProjectIndexPage";

export const routes: RouteObject[] = [
  { path: "/", element: <ProjectIndexPage /> },
  {
    path: "/projects/:projectId",
    element: <AppLayout />,
    children: [
      { index: true, element: <Navigate to="documents" replace /> },
      { path: "documents", element: <DocumentsPage /> },
      { path: "requests", element: <RequestsPage /> },
      { path: "requests/:requestId/scenarios", element: <ScenariosPage /> },
      { path: "scenarios", element: <LatestScenariosPage /> },
      { path: "monitor", element: <LatestRunPage /> },
      { path: "runs/:runId/monitor", element: <RunMonitorPage /> },
      { path: "runs/:runId/report", element: <ReportPage /> },
      { path: "report", element: <LatestReportPage /> },
      { path: "*", element: <NotFoundPage /> },
    ],
  },
  { path: "*", element: <NotFoundPage /> },
];

export function createAppRouter() {
  return createBrowserRouter(routes);
}

/** 테스트용 */
export function createTestRouter(initialPath: string) {
  return createMemoryRouter(routes, { initialEntries: [initialPath] });
}
