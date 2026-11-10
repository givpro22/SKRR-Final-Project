import { QueryClient } from "@tanstack/react-query";
import { ApiError } from "@/api/errors";

export function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 10_000,
        refetchOnWindowFocus: false,
        // 4xx는 다시 시도해도 결과가 같다.
        retry: (failureCount, error) =>
          !(error instanceof ApiError && error.status >= 400 && error.status < 500) && failureCount < 2,
      },
    },
  });
}
