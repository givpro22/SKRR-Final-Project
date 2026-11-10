import { createBrowserRouter, createMemoryRouter, Navigate, type RouteObject } from "react-router-dom";
import { DocumentsPage } from "@/features/documents/DocumentsPage";
import { ComingSoonPage } from "@/features/placeholder/ComingSoonPage";
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
      { path: "requests", element: <ComingSoonPage title="테스트 요청" /> },
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
