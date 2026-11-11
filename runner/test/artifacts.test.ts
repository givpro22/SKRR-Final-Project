import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import JSZip from "jszip";
import { containsSecret, redactTrace, scrubHar } from "../src/execution/artifacts.js";
import { maskText, secretForms } from "../src/runtime/skrr-runtime.js";

const SECRET = "p@ss word/1";

test("비밀값 형태: 원문, JSON, URL(%20·+), base64", () => {
  const forms = secretForms(SECRET);
  for (const f of [SECRET, encodeURIComponent(SECRET), encodeURIComponent(SECRET).replace(/%20/g, "+"), Buffer.from(SECRET).toString("base64")]) {
    assert.ok(forms.includes(f), f);
  }
  const text = `a=${encodeURIComponent(SECRET)}&b={"p":${JSON.stringify(SECRET)}} ${Buffer.from(SECRET).toString("base64")}`;
  assert.ok(!containsSecret(Buffer.from(maskText(text, [SECRET])), [SECRET]));
  assert.deepEqual(secretForms("ab"), []); // 너무 짧은 값은 가리지 않는다 (흔한 글자를 망가뜨리지 않게)
});

test("trace.zip의 모든 항목에서 비밀값을 가리고 원본을 지운다", async () => {
  const dir = mkdtempSync(join(tmpdir(), "skrr-art-"));
  const zip = new JSZip();
  zip.file("trace.trace", JSON.stringify({ method: "fill", params: { value: SECRET } }) + "\n");
  zip.file("trace.network", JSON.stringify({ postData: `password=${encodeURIComponent(SECRET)}` }));
  zip.file("resources/abc.html", `<input value="${SECRET}">`);
  zip.file("resources/shot.jpeg", Buffer.from([0xff, 0xd8, 0xff, 0x00, 0x01]));
  writeFileSync(join(dir, "raw.zip"), await zip.generateAsync({ type: "nodebuffer" }));
  const result = await redactTrace(join(dir, "raw.zip"), join(dir, "trace.zip"), [SECRET]);
  assert.deepEqual(result, { ok: true });
  assert.ok(!existsSync(join(dir, "raw.zip")), "원본을 남기지 않는다");
  const out = await JSZip.loadAsync(readFileSync(join(dir, "trace.zip")));
  for (const entry of Object.values(out.files)) {
    assert.ok(!containsSecret(await entry.async("nodebuffer"), [SECRET]), entry.name);
  }
  assert.match(await out.file("trace.trace")!.async("string"), /"value":"\*\*\*"/);
});

test("가릴 수 없는 곳(이미지 바이트)에 비밀값이 있으면 trace를 내주지 않는다", async () => {
  const dir = mkdtempSync(join(tmpdir(), "skrr-art-"));
  const zip = new JSZip();
  zip.file("resources/x.png", Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.from(SECRET)]));
  writeFileSync(join(dir, "raw.zip"), await zip.generateAsync({ type: "nodebuffer" }));
  const result = await redactTrace(join(dir, "raw.zip"), join(dir, "trace.zip"), [SECRET]);
  assert.equal(result.ok, false);
  assert.ok(!existsSync(join(dir, "trace.zip")));
  assert.ok(!existsSync(join(dir, "raw.zip")));
});

test("HAR: 인증 헤더·쿠키 값 삭제, 본문·URL의 비밀값 가림", () => {
  const dir = mkdtempSync(join(tmpdir(), "skrr-art-"));
  const path = join(dir, "network.har");
  writeFileSync(
    path,
    JSON.stringify({
      log: {
        entries: [
          {
            request: {
              url: `http://x/api/login?pw=${encodeURIComponent(SECRET)}`,
              headers: [{ name: "Authorization", value: "Bearer tok" }, { name: "X-Other", value: SECRET }],
              cookies: [{ name: "sid", value: "s" }],
              postData: { text: JSON.stringify({ password: SECRET }) },
            },
            response: { headers: [{ name: "Set-Cookie", value: "sid=s" }] },
          },
        ],
      },
    }),
  );
  assert.equal(scrubHar(path, [SECRET]), true);
  const har = readFileSync(path, "utf8");
  assert.ok(!containsSecret(Buffer.from(har), [SECRET]));
  assert.ok(!har.includes("Bearer tok") && !har.includes("sid=s"));
});
