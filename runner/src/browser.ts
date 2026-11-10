import { existsSync } from "node:fs";
import { chromium } from "@playwright/test";

export interface BrowserStatus {
  ok: boolean;
  detail: string;
}

/**
 * Chromium 실행 파일이 설치되어 있는지 확인한다 (runnerReady).
 * 매 확인마다 브라우저를 띄우면 프로브가 무거워지므로 실행 파일 존재만 본다.
 * 실제 기동 실패는 실행 단계에서 ENVIRONMENT_ERROR로 분류한다.
 */
export function chromiumStatus(): BrowserStatus {
  let path: string;
  try {
    path = chromium.executablePath();
  } catch (err) {
    return { ok: false, detail: `Chromium 경로를 확인하지 못했어요: ${(err as Error).message}` };
  }
  if (!path || !existsSync(path)) {
    return { ok: false, detail: "Chromium이 설치되어 있지 않아요 (npx playwright install chromium)" };
  }
  return { ok: true, detail: "Chromium 준비됨" };
}
