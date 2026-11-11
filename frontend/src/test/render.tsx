import { QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import { RouterProvider } from "react-router-dom";
import { createQueryClient } from "@/app/queryClient";
import { createTestRouter } from "@/app/router";
import { EventSourceFactoryContext, browserEventSource, type EventSourceFactory } from "@/features/runs/useRunEvents";

export function renderRoute(path: string, options: { eventSource?: EventSourceFactory } = {}) {
  const queryClient = createQueryClient();
  queryClient.setDefaultOptions({ queries: { ...queryClient.getDefaultOptions().queries, retry: false } });
  const router = createTestRouter(path);
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <EventSourceFactoryContext.Provider value={options.eventSource ?? browserEventSource}>
        <RouterProvider router={router} />
      </EventSourceFactoryContext.Provider>
    </QueryClientProvider>,
  );
  return { ...utils, router, queryClient };
}
