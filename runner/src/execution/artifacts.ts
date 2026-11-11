/**
 * 실행 증거의 비밀값 가리기 (runner.md 안전, Q-M3-3).
 *
 * - HAR: 인증 헤더·쿠키 값을 지우고 본문·URL의 비밀값을 가린다.
 * - trace.zip: 모든 항목(액션 인자, 네트워크 본문, DOM 스냅샷, 콘솔)에서 비밀값의 모든 형태를 ***로 바꿔 다시 묶는다.
 *   다시 묶은 뒤 전체를 검사해 남아 있으면 trace를 내주지 않는다. 원본은 남기지 않는다.
 */
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import JSZip from "jszip";
import { MASK, maskText, secretForms } from "../runtime/skrr-runtime.js";

const SENSITIVE_HEADERS = new Set(["authorization", "cookie", "set-cookie", "proxy-authorization", "x-test-control-token"]);

interface HarNameValue {
  name: string;
  value: string;
}
interface HarMessage {
  url?: string;
  headers?: HarNameValue[];
  cookies?: HarNameValue[];
  queryString?: HarNameValue[];
  postData?: { text?: string; params?: HarNameValue[] };
}
interface HarFile {
  log?: { entries?: Array<{ request?: HarMessage; response?: HarMessage }> };
}

export function scrubHar(path: string, secrets: string[]): boolean {
  let har: HarFile;
  try {
    har = JSON.parse(readFileSync(path, "utf8")) as HarFile;
  } catch {
    return false;
  }
  const mask = (t: string) => maskText(t, secrets);
  for (const entry of har.log?.entries ?? []) {
    for (const part of [entry.request, entry.response]) {
      if (!part) continue;
      for (const h of part.headers ?? []) h.value = SENSITIVE_HEADERS.has(h.name.toLowerCase()) ? MASK : mask(String(h.value));
      for (const c of part.cookies ?? []) c.value = MASK;
      if (part.postData?.text) part.postData.text = mask(part.postData.text);
      for (const q of part.postData?.params ?? []) q.value = mask(String(q.value));
      if (part.url) part.url = mask(part.url);
      for (const q of part.queryString ?? []) q.value = mask(String(q.value));
    }
  }
  writeFileSync(path, JSON.stringify(har));
  return !containsSecret(readFileSync(path), secrets);
}

/** 바이트 안에 비밀값(모든 형태)이 있는지 */
export function containsSecret(data: Buffer, secrets: string[]): boolean {
  for (const secret of secrets) {
    for (const form of secretForms(secret)) {
      if (data.includes(Buffer.from(form, "utf8"))) return true;
    }
  }
  return false;
}

const IMAGE_MAGIC = [Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.from([0xff, 0xd8, 0xff]), Buffer.from("RIFF")];

function isImage(data: Buffer): boolean {
  return IMAGE_MAGIC.some((m) => data.subarray(0, m.length).equals(m));
}

export type RedactResult = { ok: true } | { ok: false; reason: string };

/** trace.zip을 비밀값을 가린 새 zip(dest)으로 바꾼다. 원본(src)은 항상 지운다 */
export async function redactTrace(src: string, dest: string, secrets: string[]): Promise<RedactResult> {
  try {
    const zip = await JSZip.loadAsync(readFileSync(src));
    for (const entry of Object.values(zip.files)) {
      if (entry.dir) continue;
      const data = await entry.async("nodebuffer");
      if (isImage(data)) {
        // 화면 이미지는 글자를 바꿀 수 없다. 이미지 바이트에 비밀값 문자열이 그대로 있으면 내주지 않는다
        if (containsSecret(data, secrets)) return { ok: false, reason: `이미지 ${entry.name}에 비밀값이 있어요` };
        continue;
      }
      if (!containsSecret(data, secrets)) continue;
      zip.file(entry.name, maskText(data.toString("utf8"), secrets));
    }
    const out = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
    // 다시 묶은 결과를 풀어 전부 검사한다
    const check = await JSZip.loadAsync(out);
    for (const entry of Object.values(check.files)) {
      if (!entry.dir && containsSecret(await entry.async("nodebuffer"), secrets)) {
        return { ok: false, reason: `${entry.name}에서 비밀값을 지우지 못했어요` };
      }
    }
    writeFileSync(dest, out);
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: `trace를 다시 묶지 못했어요: ${(err as Error).message}` };
  } finally {
    rmSync(src, { force: true });
  }
}
