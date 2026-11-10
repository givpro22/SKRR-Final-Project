import createClient from "openapi-fetch";
import type { paths } from "./schema";
import { ApiError, parseProblem } from "./errors";

// 브라우저는 백엔드(/api/v1)만 호출한다 (ADR-009). 개발 서버에서는 Vite 프록시가 백엔드로 넘긴다.
const origin = typeof window === "undefined" ? "http://localhost" : window.location.origin;

export const api = createClient<paths>({
  baseUrl: `${origin}/api/v1`,
  // MSW 등 런타임에 교체되는 fetch를 쓰도록 호출 시점에 찾는다.
  fetch: (request) => globalThis.fetch(request),
});

type Result<T> = { data?: T; error?: unknown; response: Response };

/** 성공 응답의 본문을 돌려주고, 실패하면 Problem을 담은 ApiError를 던진다. */
export async function unwrap<T>(promise: Promise<Result<T>>): Promise<T> {
  const { data, error, response } = await promise;
  if (!response.ok) throw new ApiError(response.status, parseProblem(error));
  if (data === undefined) throw new ApiError(response.status, null);
  return data;
}

/** 본문이 없는 성공 응답(204)용. */
export async function unwrapEmpty(promise: Promise<Result<unknown>>): Promise<void> {
  const { error, response } = await promise;
  if (!response.ok) throw new ApiError(response.status, parseProblem(error));
}
