import { QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import { RouterProvider } from "react-router-dom";
import { createQueryClient } from "@/app/queryClient";
import { createTestRouter } from "@/app/router";

export function renderRoute(path: string) {
  const queryClient = createQueryClient();
  queryClient.setDefaultOptions({ queries: { ...queryClient.getDefaultOptions().queries, retry: false } });
  const router = createTestRouter(path);
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { ...utils, router, queryClient };
}
