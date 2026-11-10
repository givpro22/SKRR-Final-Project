/**
 * RUNNER_ALLOWED_TARGET_HOSTS 처리 (ADR-005).
 * 항목은 쉼표로 구분한다. `host`는 모든 포트, `host:port`는 그 포트만 허용한다.
 * 실제 운영 시스템과 외부 서비스는 테스트 대상이 아니므로 목록에 없는 호스트는 모두 거부한다.
 */

export interface AllowedHost {
  hostname: string;
  port: number | null;
}

const ENTRY = /^(\[[0-9a-f:.]+\]|[a-z0-9.-]+)(?::(\d{1,5}))?$/i;

export function parseAllowedHosts(raw: string): AllowedHost[] {
  const hosts: AllowedHost[] = [];
  for (const part of raw.split(",")) {
    const entry = part.trim().toLowerCase();
    if (!entry) continue;
    const match = ENTRY.exec(entry);
    if (!match?.[1]) {
      throw new Error(`RUNNER_ALLOWED_TARGET_HOSTS 항목 형식이 올바르지 않습니다: ${part.trim()}`);
    }
    hosts.push({ hostname: match[1], port: match[2] ? Number(match[2]) : null });
  }
  return hosts;
}

function effectivePort(url: URL): number {
  if (url.port) return Number(url.port);
  return url.protocol === "https:" ? 443 : 80;
}

export type UrlCheck = { ok: true; url: URL } | { ok: false; reason: string };

/** 대상 URL이 http(s)이고 허용 목록의 호스트인지 확인한다. */
export function checkTargetUrl(raw: string, allowed: AllowedHost[]): UrlCheck {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: "URL 형식이 올바르지 않아요" };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, reason: "http 또는 https 주소만 확인할 수 있어요" };
  }
  if (url.username || url.password) {
    return { ok: false, reason: "주소에 계정 정보를 넣을 수 없어요" };
  }
  const hostname = url.hostname.toLowerCase();
  const port = effectivePort(url);
  const permitted = allowed.some((h) => h.hostname === hostname && (h.port === null || h.port === port));
  if (!permitted) {
    return {
      ok: false,
      reason: `허용되지 않은 대상 호스트예요 (${url.host}). 실행기 설정 RUNNER_ALLOWED_TARGET_HOSTS에 등록해야 해요`,
    };
  }
  return { ok: true, url };
}
