import { checkTargetUrl, type AllowedHost } from "./allowlist.js";

/** runner-api.openapi.yaml checkTargetConnectivity 응답 */
export interface ConnectivityResult {
  reachable: boolean;
  statusCode: number | null;
  message: string | null;
}

export interface ConnectivityOptions {
  allowedHosts: AllowedHost[];
  timeoutMs: number;
  fetchImpl?: typeof fetch;
}

/**
 * 대상 사이트에 HTTP GET을 보내 응답하는지 확인한다.
 * 리다이렉트는 따라가지 않는다. 따라가면 허용 목록 밖으로 나갈 수 있기 때문이다.
 * 판정은 runner-api checkTargetConnectivity 표를 따른다 (ADR-019): 응답이 오면 statusCode를 항상 넣고,
 * 2xx·3xx·4xx는 서버가 응답한 것이므로 도달 가능, 5xx는 도달 불가. 접속 실패도 예외 대신 200으로 돌려준다.
 */
export async function checkConnectivity(targetUrl: string, opts: ConnectivityOptions): Promise<ConnectivityResult> {
  const check = checkTargetUrl(targetUrl, opts.allowedHosts);
  if (!check.ok) {
    return { reachable: false, statusCode: null, message: check.reason };
  }
  const fetchImpl = opts.fetchImpl ?? fetch;
  try {
    const res = await fetchImpl(check.url, {
      method: "GET",
      redirect: "manual",
      signal: AbortSignal.timeout(opts.timeoutMs),
      headers: { "user-agent": "skrr-runner-connectivity-check" },
    });
    // 본문은 쓰지 않으므로 바로 닫아 연결을 돌려준다.
    await res.body?.cancel().catch(() => undefined);
    return judge(res.status);
  } catch (err) {
    return { reachable: false, statusCode: null, message: describeFetchError(err, opts.timeoutMs) };
  }
}

function describeFetchError(err: unknown, timeoutMs: number): string {
  if (err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError")) {
    return `${Math.round(timeoutMs / 1000)}초 안에 응답이 없어요`;
  }
  const cause = err instanceof Error ? (err.cause as { code?: string } | undefined) : undefined;
  switch (cause?.code) {
    case "ECONNREFUSED":
      return "대상 사이트가 연결을 거부했어요 (서버가 꺼져 있거나 포트가 달라요)";
    case "ENOTFOUND":
    case "EAI_AGAIN":
      return "대상 사이트 주소를 찾지 못했어요 (DNS)";
    case "CERT_HAS_EXPIRED":
    case "DEPTH_ZERO_SELF_SIGNED_CERT":
    case "SELF_SIGNED_CERT_IN_CHAIN":
    case "UNABLE_TO_VERIFY_LEAF_SIGNATURE":
      return "대상 사이트의 TLS 인증서를 확인하지 못했어요";
    default:
      return `대상 사이트에 접속하지 못했어요${cause?.code ? ` (${cause.code})` : ""}`;
  }
}

/** 응답 상태 코드로 판정한다. 4xx(인증 필요, 경로 없음 등)도 서버가 살아 있으므로 도달 가능이다. */
export function judge(status: number): ConnectivityResult {
  if (status >= 500) {
    return {
      reachable: false,
      statusCode: status,
      message: `대상 사이트가 서버 오류로 응답했어요 (HTTP ${status})`,
    };
  }
  if (status >= 400) {
    return {
      reachable: true,
      statusCode: status,
      message: `대상 사이트가 응답했어요 (HTTP ${status}). 인증이나 경로가 맞는지 확인해 보세요`,
    };
  }
  return { reachable: true, statusCode: status, message: "대상 사이트에 접속했어요" };
}
