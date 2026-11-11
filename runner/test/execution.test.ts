/**
 * 실제 Chromium으로 가짜 대상 사이트(test/fixtures/target-site)를 실행한다.
 * Chromium이 없으면 건너뛴다 (보고서에 미검증으로 적는다).
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";
import type { FastifyInstance } from "fastify";
import JSZip from "jszip";
import { secretForms } from "../src/runtime/skrr-runtime.js";
import { buildApp } from "../src/app.js";
import { parseAllowedHosts } from "../src/allowlist.js";
import { chromiumStatus } from "../src/browser.js";
import type { RunnerConfig } from "../src/config.js";
import { CONTROL_TOKEN, MEMBER, startTargetSite, type FaultId, type TargetSite } from "./fixtures/target-site/server.js";

const browser = chromiumStatus();
let site: TargetSite;
let app: FastifyInstance;

function config(): RunnerConfig {
  return {
    host: "127.0.0.1",
    port: 0,
    logLevel: "silent",
    allowedHosts: parseAllowedHosts("127.0.0.1"),
    connectivityTimeoutMs: 2000,
    artifactRetentionMs: 30 * 60_000,
    actionTimeoutMs: 2500,
  };
}

const LOGIN = [
  { id: "s01", description: "로그인 화면", action: "goto", path: "/login" },
  { id: "s02", description: "이메일", action: "fill", testId: "login-email-input", value: "{{memberEmail}}" },
  { id: "s03", description: "비밀번호", action: "fill", testId: "login-password-input", value: "{{memberPassword}}" },
  {
    id: "s04",
    description: "로그인 버튼",
    action: "waitForApi",
    method: "POST",
    path: "/api/auth/login",
    trigger: "login-submit-button",
    expectStatus: 200,
    captures: { token: "$.accessToken" },
    responseSchema: { type: "object", required: ["accessToken"], properties: { accessToken: { type: "string" } } },
  },
  { id: "s05", description: "상품 화면으로 이동했는지", action: "expectUrl", path: "/products" },
];

const CART_SCHEMA = {
  type: "object",
  required: ["items", "totalAmount"],
  properties: { items: { type: "array" }, totalAmount: { type: "integer" } },
};

function query(extra: Record<string, unknown>[] = [], code = "TC-01"): Record<string, unknown> {
  return {
    schemaVersion: "1.0",
    testCaseCode: code,
    title: "장바구니 담기 정상 처리",
    variables: { memberEmail: MEMBER.email, productId: "1001" },
    secretCaptures: ["token"],
    steps: [
      ...LOGIN,
      { id: "s06", description: "상품 상세", action: "goto", path: "/products/{{productId}}" },
      { id: "s07", description: "수량", action: "fill", testId: "product-qty-input", value: "1" },
      {
        id: "s08",
        description: "담기",
        action: "waitForApi",
        method: "POST",
        path: "/api/cart/items",
        trigger: "cart-add-button",
        expectStatus: 201,
      },
      {
        id: "s09",
        description: "장바구니 API",
        action: "apiRequest",
        method: "GET",
        path: "/api/cart",
        headers: { Authorization: "Bearer {{token}}" },
        expectStatus: 200,
        captures: { apiTotal: "$.totalAmount" },
        responseSchema: CART_SCHEMA,
      },
      { id: "s10", description: "장바구니 화면", action: "goto", path: "/cart" },
      { id: "s11", description: "화면 합계", action: "captureText", testId: "cart-total-amount", as: "uiTotal" },
      { id: "s12", description: "합계 문구", action: "expectText", testId: "cart-total-amount", text: "75,000원" },
      { id: "s13", description: "API 합계", action: "expectCapture", capture: "apiTotal", equals: "75000" },
      ...extra,
    ],
    crossChecks: [{ label: "합계 (화면·API·DB)", uiCapture: "uiTotal", apiCapture: "apiTotal", consistencyOnly: true, reason: "r", normalize: "CURRENCY" }],
  };
}

function execRequest(tq: Record<string, unknown>, overrides: Record<string, unknown> = {}) {
  return {
    executionId: randomUUID(),
    baseUrl: site.url,
    testQuery: tq,
    secretVariables: { memberPassword: MEMBER.password },
    viewport: { width: 1280, height: 800 },
    timeoutMs: 30_000,
    ...overrides,
  };
}

/** null이면 장애를 모두 풀고 데이터를 초기화한다 (reset은 장애를 지우지 않으므로 DELETE /faults를 함께 부른다) */
async function fault(id: FaultId | null): Promise<void> {
  const headers = { "content-type": "application/json", "x-test-control-token": CONTROL_TOKEN };
  if (id) {
    await fetch(`${site.url}/api/test/faults`, { method: "POST", headers, body: JSON.stringify({ faultId: id }) });
    return;
  }
  await fetch(`${site.url}/api/test/faults`, { method: "DELETE", headers });
  await fetch(`${site.url}/api/test/reset`, { method: "POST", headers, body: JSON.stringify({ seed: "default" }) });
}

async function waitDone(id: string): Promise<Record<string, any>> {
  for (let i = 0; i < 400; i++) {
    const res = await app.inject({ method: "GET", url: `/internal/v1/executions/${id}` });
    const body = res.json<Record<string, any>>();
    if (["PASSED", "FAILED", "ERROR", "CANCELLED"].includes(body.status)) return body;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("실행이 끝나지 않음");
}

async function run(tq: Record<string, unknown>, overrides: Record<string, unknown> = {}) {
  const req = execRequest(tq, overrides);
  const res = await app.inject({ method: "POST", url: "/internal/v1/executions", payload: req });
  assert.equal(res.statusCode, 202, res.body);
  return waitDone(req.executionId);
}

describe("실행 (실제 Chromium)", { skip: browser.ok ? false : `Chromium 없음: ${browser.detail}` }, () => {
  before(async () => {
    site = await startTargetSite();
    app = buildApp({ config: config(), logger: false });
  });
  after(async () => {
    await app.close();
    await site.close();
  });

  test("정상 실행: 단계·API 호출·캡처·증거, 비밀값 가림", async () => {
    await fault(null);
    const exec = await run(query());
    assert.equal(exec.status, "PASSED", JSON.stringify(exec.steps.filter((s: any) => s.status !== "PASSED")));
    assert.equal(exec.failureType, null);
    assert.match(exec.browserVersion, /^Chromium \d+/);
    assert.equal(exec.steps.length, 13);
    assert.ok(exec.steps.every((s: any) => s.status === "PASSED"));
    const login = exec.steps.find((s: any) => s.stepId === "s04");
    assert.equal(login.kind, "API");
    assert.equal(login.schemaCheck, "PASSED");
    assert.equal(exec.steps.find((s: any) => s.stepId === "s08").schemaCheck, "NOT_CHECKED");
    assert.ok(exec.apiCalls.some((c: any) => c.method === "POST" && c.path === "/api/auth/login" && c.statusCode === 200));
    assert.ok(exec.apiCalls.some((c: any) => c.method === "GET" && c.path === "/api/cart" && c.statusCode === 200));
    // 비밀 캡처(token)는 결과에 없다
    assert.deepEqual(Object.keys(exec.captures).sort(), ["apiTotal", "uiTotal"]);
    assert.equal(exec.captures.uiTotal, "75,000원");
    const names = exec.artifacts.map((a: any) => a.name);
    for (const n of ["trace.zip", "network.har", "step-1.png", "step-13.png"]) assert.ok(names.includes(n), n);

    // 비밀번호와 토큰이 결과·이벤트·HAR 어디에도 없다
    const token = [...site.state().sessions.keys()].at(-1)!;
    const events = await app.inject({ method: "GET", url: `/internal/v1/executions/${exec.executionId}/events` });
    const har = await app.inject({ method: "GET", url: `/internal/v1/executions/${exec.executionId}/artifacts/network.har` });
    assert.equal(har.statusCode, 200);
    assert.match(String(har.headers["content-type"]), /application\/json/);
    for (const text of [JSON.stringify(exec), events.body, har.body]) {
      assert.ok(!text.includes(MEMBER.password), "비밀번호 노출");
      assert.ok(!text.includes(token), "토큰 노출");
    }
    // Q-M3-3: trace.zip 안 모든 항목(액션 인자, 네트워크 본문, DOM 스냅샷)에 비밀값의 어떤 형태도 없다
    const trace = await app.inject({ method: "GET", url: `/internal/v1/executions/${exec.executionId}/artifacts/trace.zip` });
    assert.equal(trace.statusCode, 200);
    const zip = await JSZip.loadAsync(trace.rawPayload);
    const entries = Object.values(zip.files).filter((f) => !f.dir);
    assert.ok(entries.some((f) => f.name.endsWith(".trace")), "trace 내용이 있어야 한다");
    let masked = 0;
    for (const entry of entries) {
      const data = await entry.async("nodebuffer");
      for (const form of [...secretForms(MEMBER.password), ...secretForms(token)]) {
        assert.ok(!data.includes(Buffer.from(form)), `${entry.name}에 비밀값 형태 '${form.slice(0, 4)}…' 노출`);
      }
      if (data.includes(Buffer.from("***"))) masked++;
    }
    assert.ok(masked > 0, "가린 흔적(***)이 있어야 한다 (비밀번호 입력 단계)");
    for (const name of names.filter((n: string) => n.endsWith(".png"))) {
      const shot = await app.inject({ method: "GET", url: `/internal/v1/executions/${exec.executionId}/artifacts/${name}` });
      assert.ok(!shot.rawPayload.includes(Buffer.from(MEMBER.password)));
    }
    const png = await app.inject({ method: "GET", url: `/internal/v1/executions/${exec.executionId}/artifacts/step-1.png` });
    assert.equal(png.statusCode, 200);
    assert.equal(png.headers["content-type"], "image/png");

    // SSE: 지난 이벤트를 보내고 마지막 status 뒤 닫힌다
    assert.match(String(events.headers["content-type"]), /text\/event-stream/);
    const types = [...events.body.matchAll(/^event: (.+)$/gm)].map((m) => m[1]);
    assert.equal(types[0], "status");
    assert.equal(types.at(-1), "status");
    for (const t of ["step", "api.call", "screenshot"]) assert.ok(types.includes(t), t);
    const last = JSON.parse(events.body.trim().split("\n").at(-1)!.slice(6));
    assert.deepEqual(last.data, { status: "PASSED" });
    const shot = events.body.split("\n\n").find((e) => e.includes("event: screenshot"))!;
    const shotData = JSON.parse(shot.split("\n").find((l) => l.startsWith("data: "))!.slice(6)).data;
    assert.deepEqual(Object.keys(shotData).sort(), ["name", "order", "pagePath", "stepId"]);
    // Last-Event-ID 이후만 다시 받는다
    const resumed = await app.inject({ method: "GET", url: `/internal/v1/executions/${exec.executionId}/events`, headers: { "last-event-id": "3" } });
    assert.match(resumed.body, /^id: 4$/m);
    assert.doesNotMatch(resumed.body, /^id: 3$/m);
  });

  test("가짜 대상 사이트: reset은 데이터만 되돌리고 장애는 유지 (target-site-contract)", async () => {
    await fault(null);
    await fault("cart-add-500");
    const headers = { "content-type": "application/json", "x-test-control-token": CONTROL_TOKEN };
    await fetch(`${site.url}/api/test/reset`, { method: "POST", headers, body: "{}" });
    assert.ok(site.state().faults.has("cart-add-500"));
    await fetch(`${site.url}/api/test/faults`, { method: "DELETE", headers });
    assert.equal(site.state().faults.size, 0);
  });

  test("입력 요소 값은 inputValue로 읽는다 (Q-M3-7)", async () => {
    await fault(null);
    const tq = {
      schemaVersion: "1.0",
      testCaseCode: "TC-09",
      title: "장바구니 수량 캡처",
      variables: { memberEmail: MEMBER.email },
      steps: [
        ...LOGIN,
        { id: "s06", description: "장바구니", action: "goto", path: "/cart" },
        { id: "s07", description: "수량(input)", action: "captureText", testId: "cart-item-quantity", as: "uiQty" },
        { id: "s08", description: "합계(span)", action: "captureText", testId: "cart-total-amount", as: "uiTotal" },
        { id: "s09", description: "수량 비교", action: "expectCapture", capture: "uiQty", equals: "2" },
      ],
    };
    const exec = await run(tq);
    assert.equal(exec.status, "PASSED", JSON.stringify(exec.steps.find((s: any) => s.status === "FAILED")));
    assert.equal(exec.captures.uiQty, "2");
    assert.equal(exec.captures.uiTotal, "50,000원");
  });

  test("오류 문구에 ANSI 색 코드가 없다 (Q-M3-6)", async () => {
    await fault(null);
    await fault("remove-button-missing");
    const exec = await run(query([{ id: "s14", description: "삭제", action: "click", testId: "cart-remove-button" }]));
    const failed = exec.steps.find((s: any) => s.status === "FAILED");
    assert.ok(failed.detail);
    // eslint-disable-next-line no-control-regex
    assert.doesNotMatch(failed.detail + exec.failureMessage, /\u001b\[|\[2m|\[22m/);
    assert.ok(failed.detail.split("\n").length <= 5);
  });

  test("API 호출 시간은 요청 시작부터 응답 끝까지 (Q-M3-4)", async () => {
    await fault(null);
    const exec = await run(query());
    const calls = exec.apiCalls.filter((c: any) => c.path.startsWith("/api/"));
    assert.ok(calls.length >= 3);
    assert.ok(calls.every((c: any) => c.durationMs >= 10), JSON.stringify(calls));
  });

  test("로그인 응답 뒤 화면 이동과 다음 goto가 겹쳐도 매번 같은 결과 (Q-M3-1, NFR-01)", async () => {
    // expectUrl 없이 로그인 직후 바로 다른 화면으로 이동한다
    const tq = {
      schemaVersion: "1.0",
      testCaseCode: "TC-05",
      title: "로그인 직후 이동",
      variables: { memberEmail: MEMBER.email, productId: "1001" },
      steps: [
        ...LOGIN.slice(0, 3),
        { id: "s04", description: "로그인", action: "waitForApi", method: "POST", path: "/api/auth/login", trigger: "login-submit-button", expectStatus: 200 },
        { id: "s05", description: "상품 상세", action: "goto", path: "/products/{{productId}}" },
        { id: "s06", description: "수량", action: "fill", testId: "product-qty-input", value: "1" },
        { id: "s07", description: "가격", action: "expectText", testId: "product-price", text: "25,000원" },
      ],
    };
    const statuses = [];
    for (let i = 0; i < 5; i++) {
      await fault(null);
      const exec = await run(tq);
      statuses.push(exec.status);
      assert.equal(exec.status, "PASSED", JSON.stringify({ failureType: exec.failureType, failureMessage: exec.failureMessage, steps: exec.steps }));
    }
    assert.deepEqual(statuses, Array(5).fill("PASSED"));
  });

  test("apiRequest는 화면 로그인 쿠키를 함께 보낸다 (Authorization 헤더 없이)", async () => {
    await fault(null);
    const tq = {
      schemaVersion: "1.0",
      testCaseCode: "TC-08",
      title: "쿠키로 API 호출",
      variables: { memberEmail: MEMBER.email },
      steps: [
        ...LOGIN,
        { id: "s06", description: "장바구니 API", action: "apiRequest", method: "GET", path: "/api/cart", expectStatus: 200, responseSchema: CART_SCHEMA },
      ],
    };
    const exec = await run(tq);
    assert.equal(exec.status, "PASSED", JSON.stringify(exec.steps.find((s: any) => s.status === "FAILED")));
  });

  test("waitForApi의 {이름} 자리는 아무 한 세그먼트와 맞는다 (주문 취소)", async () => {
    await fault(null);
    const tq = {
      schemaVersion: "1.0",
      testCaseCode: "TC-06",
      title: "주문 취소",
      variables: { memberEmail: MEMBER.email },
      steps: [
        ...LOGIN,
        { id: "s06", description: "주문 내역", action: "goto", path: "/orders" },
        {
          id: "s07",
          description: "취소",
          action: "waitForApi",
          method: "POST",
          path: "/api/orders/{orderId}/cancel",
          trigger: "order-cancel-button",
          expectStatus: 200,
          captures: { cancelledId: "$.orderId", cancelledStatus: "$.status" },
        },
        { id: "s08", description: "상태", action: "expectCapture", capture: "cancelledStatus", equals: "CANCELLED" },
      ],
    };
    const exec = await run(tq);
    assert.equal(exec.status, "PASSED", JSON.stringify(exec.steps.find((s: any) => s.status === "FAILED")));
    assert.equal(exec.captures.cancelledId, "ORD-0001");
  });

  const faultCases: Array<[FaultId, string, string, string]> = [
    ["cart-add-500", "API_ERROR", "s08", "500"],
    ["cart-schema-break", "API_SCHEMA_MISMATCH", "s09", ""],
    ["cart-total-ui-mismatch", "ASSERTION_FAILED", "s12", "76,000원"],
  ];
  for (const [id, failureType, stepId, actual] of faultCases) {
    test(`장애 ${id} → ${failureType}`, async () => {
      await fault(null);
      await fault(id);
      const exec = await run(query());
      assert.equal(exec.status, "FAILED");
      assert.equal(exec.failureType, failureType);
      const failed = exec.steps.find((s: any) => s.stepId === stepId);
      assert.equal(failed.status, "FAILED");
      if (actual) assert.equal(failed.actualValue, actual);
      if (failureType === "API_SCHEMA_MISMATCH") {
        assert.equal(failed.schemaCheck, "FAILED");
        assert.deepEqual(failed.schemaErrors, ["$.totalAmount 는 integer여야 함"]);
      }
      const after = exec.steps.filter((s: any) => s.order > failed.order);
      assert.ok(after.every((s: any) => s.status === "SKIPPED"));
    });
  }

  test("요소가 사라지면 ELEMENT_NOT_FOUND", async () => {
    await fault(null);
    await fault("remove-button-missing");
    const exec = await run(query([{ id: "s14", description: "삭제", action: "click", testId: "cart-remove-button" }]));
    assert.equal(exec.failureType, "ELEMENT_NOT_FOUND");
    assert.equal(exec.steps.at(-1).status, "FAILED");
  });

  test("시간 초과는 FAILED TIMEOUT, 중단은 CANCELLED (10초 이내)", async () => {
    await fault(null);
    await fault("login-slow");
    const timedOut = await run(query(), { timeoutMs: 3000 });
    assert.equal(timedOut.status, "FAILED");
    assert.equal(timedOut.failureType, "TIMEOUT");

    const req = execRequest(query());
    await app.inject({ method: "POST", url: "/internal/v1/executions", payload: req });
    // 실행 중: RUNNER_BUSY, trace는 아직 없음
    const busy = await app.inject({ method: "POST", url: "/internal/v1/executions", payload: execRequest(query()) });
    assert.equal(busy.statusCode, 409);
    assert.equal(busy.json<{ code: string }>().code, "RUNNER_BUSY");
    const early = await app.inject({ method: "GET", url: `/internal/v1/executions/${req.executionId}/artifacts/trace.zip` });
    assert.equal(early.statusCode, 409);
    assert.equal(early.json<{ code: string }>().code, "ARTIFACT_NOT_READY");
    await new Promise((r) => setTimeout(r, 1500));
    const started = Date.now();
    const cancel = await app.inject({ method: "POST", url: `/internal/v1/executions/${req.executionId}/cancel` });
    assert.equal(cancel.statusCode, 202);
    const exec = await waitDone(req.executionId);
    assert.equal(exec.status, "CANCELLED");
    assert.ok(Date.now() - started < 10_000);
    assert.ok(exec.steps.some((s: any) => s.status === "SKIPPED"));
  });

  test("치환한 경로가 사이트 밖이면 ERROR TEST_CODE_ERROR", async () => {
    await fault(null);
    const tq = {
      schemaVersion: "1.0",
      testCaseCode: "TC-02",
      title: "경로 이탈",
      variables: { evil: "/evil.example/x" },
      steps: [{ id: "s01", description: "이동", action: "goto", path: "/{{evil}}" }],
    };
    const exec = await run(tq);
    assert.equal(exec.status, "ERROR");
    assert.equal(exec.failureType, "TEST_CODE_ERROR");
  });

  test("허용 목록 밖 요청은 브라우저에서 막는다", async () => {
    await fault(null);
    const tq = {
      schemaVersion: "1.0",
      testCaseCode: "TC-03",
      title: "외부 요청",
      steps: [
        { id: "s01", description: "이동", action: "goto", path: "/login" },
        { id: "s02", description: "보임", action: "expectVisible", testId: "login-submit-button" },
      ],
    };
    const exec = await run(tq);
    assert.equal(exec.status, "PASSED");
  });
});

describe("요청 검사 (브라우저 불필요)", () => {
  let localApp: FastifyInstance;
  before(() => {
    localApp = buildApp({ config: config(), logger: false });
  });
  after(async () => localApp.close());

  test("422: TestQuery 스키마 위반, 허용 안 된 대상, 형식 오류 / 404", async () => {
    const base = { executionId: randomUUID(), baseUrl: "http://127.0.0.1:9", viewport: { width: 1280, height: 800 }, timeoutMs: 5000 };
    const bad = await localApp.inject({ method: "POST", url: "/internal/v1/executions", payload: { ...base, testQuery: { schemaVersion: "1.0" } } });
    assert.equal(bad.statusCode, 422);
    assert.equal(bad.json<{ code: string }>().code, "INVALID_TEST_QUERY");
    const tq = { schemaVersion: "1.0", testCaseCode: "TC-01", title: "t", steps: [{ id: "s01", description: "d", action: "goto", path: "/" }] };
    const host = await localApp.inject({ method: "POST", url: "/internal/v1/executions", payload: { ...base, baseUrl: "https://example.com", testQuery: tq } });
    assert.equal(host.statusCode, 422);
    assert.equal(host.json<{ code: string }>().code, "TARGET_NOT_ALLOWED");
    const shape = await localApp.inject({ method: "POST", url: "/internal/v1/executions", payload: { ...base, executionId: "x", testQuery: tq } });
    assert.equal(shape.statusCode, 422);
    for (const url of [`/internal/v1/executions/${randomUUID()}`, `/internal/v1/executions/${randomUUID()}/events`, `/internal/v1/executions/${randomUUID()}/artifacts/trace.zip`]) {
      assert.equal((await localApp.inject({ method: "GET", url })).statusCode, 404, url);
    }
    assert.equal((await localApp.inject({ method: "POST", url: `/internal/v1/executions/${randomUUID()}/cancel` })).statusCode, 404);
  });
});
