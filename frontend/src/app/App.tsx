import { QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { RouterProvider } from "react-router-dom";
import { createQueryClient } from "./queryClient";
import { createAppRouter } from "./router";

export function App() {
  const [queryClient] = useState(createQueryClient);
  const [router] = useState(() => createAppRouter());
  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
}
