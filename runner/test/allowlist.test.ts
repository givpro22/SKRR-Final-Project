import assert from "node:assert/strict";
import { test } from "node:test";
import { checkTargetUrl, parseAllowedHosts } from "../src/allowlist.js";
import { loadConfig } from "../src/config.js";

test("허용 목록 파싱: 포트 유무, 대소문자, 빈 항목", () => {
  assert.deepEqual(parseAllowedHosts(" Shop.Local , localhost:5173,,[::1]:8080 "), [
    { hostname: "shop.local", port: null },
    { hostname: "localhost", port: 5173 },
    { hostname: "[::1]", port: 8080 },
  ]);
  assert.deepEqual(parseAllowedHosts(""), []);
  assert.throws(() => parseAllowedHosts("http://shop.local"));
  assert.throws(() => parseAllowedHosts("shop.local/path"));
});

test("대상 URL 검사", () => {
  const allowed = parseAllowedHosts("shop.local,localhost:5173,api.test:80,[::1]:8080");
  assert.equal(checkTargetUrl("http://shop.local:9999/a", allowed).ok, true);
  assert.equal(checkTargetUrl("https://SHOP.local", allowed).ok, true);
  assert.equal(checkTargetUrl("http://localhost:5173/", allowed).ok, true);
  assert.equal(checkTargetUrl("http://localhost:5174/", allowed).ok, false);
  // 기본 포트 80은 URL에 포트가 없어도 일치한다.
  assert.equal(checkTargetUrl("http://api.test/", allowed).ok, true);
  assert.equal(checkTargetUrl("https://api.test/", allowed).ok, false);
  assert.equal(checkTargetUrl("http://[::1]:8080/", allowed).ok, true);
  assert.equal(checkTargetUrl("http://evil.example/", allowed).ok, false);
  // 허용 호스트를 접두사로 흉내 낸 주소
  assert.equal(checkTargetUrl("http://shop.local.evil.example/", allowed).ok, false);
  assert.equal(checkTargetUrl("http://user:pw@shop.local/", allowed).ok, false);
  assert.equal(checkTargetUrl("file:///etc/passwd", allowed).ok, false);
  assert.equal(checkTargetUrl("not a url", allowed).ok, false);
  assert.equal(checkTargetUrl("http://shop.local/", []).ok, false);
});

test("설정 기본값과 오류", () => {
  const c = loadConfig({});
  assert.equal(c.port, 3001);
  assert.equal(c.host, "0.0.0.0");
  assert.deepEqual(c.allowedHosts, []);
  assert.equal(loadConfig({ PORT: "4000" }).port, 4000);
  assert.throws(() => loadConfig({ PORT: "abc" }));
});
