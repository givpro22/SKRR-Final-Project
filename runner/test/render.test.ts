import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { buildApp } from "../src/app.js";
import { parseAllowedHosts } from "../src/allowlist.js";
import { compileSpec } from "../src/render/compile.js";
import { RENDERER_VERSION, renderSpec } from "../src/render/render.js";
import { TEST_QUERY_SCHEMA, validateTestQuery } from "../src/schema.js";
import type { TestQuery } from "../src/testQuery.js";

const ALL_ACTIONS: TestQuery = {
  schemaVersion: "1.0",
  testCaseCode: "TC-12",
  title: "모든 동작",
  variables: {},
  secretCaptures: ["token"],
  steps: [
    { id: "s01", description: "이동", action: "goto", path: "/products/{{productId}}" },
    { id: "s02", description: "클릭", action: "click", testId: "cart-add-button" },
    { id: "s03", description: "입력", action: "fill", testId: "product-qty-input", value: "2" },
    { id: "s04", description: "선택", action: "selectOption", testId: "coupon-select", value: "WELCOME5000" },
    { id: "s05", description: "보임", action: "expectVisible", testId: "cart-total-amount" },
    { id: "s06", description: "문구", action: "expectText", testId: "cart-total-amount", text: "50,000원", match: "EXACT" },
    { id: "s07", description: "개수", action: "expectCount", testId: "product-card", count: 1 },
    { id: "s08", description: "엔터", action: "press", testId: "search-input", key: "Enter" },
    { id: "s09", description: "경로", action: "expectUrl", path: "/cart" },
    { id: "s10", description: "캡처", action: "captureText", testId: "cart-total-amount", as: "uiTotal" },
    { id: "s11", description: "API 대기", action: "waitForApi", method: "POST", path: "/api/cart/items", trigger: "cart-add-button", expectStatus: 201 },
    {
      id: "s12",
      description: "API 호출",
      action: "apiRequest",
      method: "PATCH",
      path: "/api/cart/items/{{productId}}",
      headers: { Authorization: "Bearer {{token}}" },
      body: { quantity: 3 },
      expectStatus: 200,
      captures: { apiTotal: "$.totalAmount" },
      responseSchema: { type: "object" },
    },
    { id: "s13", description: "캡처 비교", action: "expectCapture", capture: "apiTotal", equals: "75000" },
  ],
};

test("계약 사본이 docs와 같다", () => {
  const docs = JSON.parse(readFileSync(new URL("../../docs/contracts/schemas/test-query.schema.json", import.meta.url), "utf8"));
  assert.deepEqual(TEST_QUERY_SCHEMA, docs);
});

test("모든 동작을 변환하고 tsc 검사를 통과한다", () => {
  assert.equal(validateTestQuery(ALL_ACTIONS).ok, true);
  const r = renderSpec(ALL_ACTIONS);
  assert.equal(r.fileName, "tc-12.spec.ts");
  assert.equal(r.rendererVersion, RENDERER_VERSION);
  assert.deepEqual(compileSpec(r.specSource, r.fileName), { compileStatus: "PASSED", compileErrors: [] });
  assert.match(r.specSource, /await rt\.waitForApi\("POST", "\/api\/cart\/items", "cart-add-button", \{"expectStatus":201\}\);/);
  assert.equal(r.specSource.match(/await rt\.step\(/g)?.length, 13);
});

test("같은 입력이면 같은 코드", () => {
  assert.equal(renderSpec(ALL_ACTIONS).specSource, renderSpec(structuredClone(ALL_ACTIONS)).specSource);
});

test("따옴표·백틱·${}·줄바꿈·*/ 가 든 값으로 코드 주입이 안 된다", () => {
  const evil = '"); process.exit(1); //`${process.env.X}`*/\n ';
  const tq: TestQuery = {
    ...ALL_ACTIONS,
    title: evil,
    steps: [
      { id: "s01", description: evil, action: "fill", testId: "search-input", value: evil },
      { id: "s02", description: "x", action: "expectText", testId: "search-input", text: evil },
    ],
  };
  const r = renderSpec(tq);
  assert.deepEqual(compileSpec(r.specSource, r.fileName).compileStatus, "PASSED");
  assert.doesNotMatch(r.specSource, /^\s*process\.exit/m);
  // 값은 JSON 문자열 리터럴로만 들어간다
  assert.ok(r.specSource.includes(JSON.stringify(evil)));
});

test("문법이 틀린 코드는 FAILED와 오류 위치", () => {
  const r = renderSpec(ALL_ACTIONS);
  const result = compileSpec(r.specSource.replace("rt.click(", "rt.clik("), r.fileName);
  assert.equal(result.compileStatus, "FAILED");
  assert.match(result.compileErrors[0]!, /^tc-12\.spec\.ts:\d+:\d+ /);
});

test("renderSpec API: 200 PASSED, 스키마 위반 422", async () => {
  const app = buildApp({
    config: { host: "127.0.0.1", port: 0, logLevel: "silent", allowedHosts: parseAllowedHosts(""), connectivityTimeoutMs: 1000, artifactRetentionMs: 1_800_000, actionTimeoutMs: 1000 },
    logger: false,
  });
  const ok = await app.inject({ method: "POST", url: "/internal/v1/specs/render", payload: { testQuery: ALL_ACTIONS } });
  assert.equal(ok.statusCode, 200);
  const body = ok.json<Record<string, unknown>>();
  assert.deepEqual(Object.keys(body).sort(), ["compileErrors", "compileStatus", "fileName", "rendererVersion", "specSource"]);
  assert.equal(body.compileStatus, "PASSED");
  const bad = await app.inject({ method: "POST", url: "/internal/v1/specs/render", payload: { testQuery: { ...ALL_ACTIONS, steps: [{ id: "s1", description: "d", action: "eval", code: "x" }] } } });
  assert.equal(bad.statusCode, 422);
  assert.equal(bad.json<{ code: string }>().code, "INVALID_TEST_QUERY");
  await app.close();
});
