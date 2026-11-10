import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, test } from "node:test";
import { buildApp } from "../src/app.js";
import { parseAllowedHosts } from "../src/allowlist.js";
import type { RunnerConfig } from "../src/config.js";
import { ExecutionSlot } from "../src/executionSlot.js";

let target: Server;
let base: string;
let requests = 0;

before(async () => {
  target = createServer((req, res) => {
    requests += 1;
    if (req.url === "/fail") {
      res.writeHead(503).end("down");
    } else if (req.url === "/auth") {
      res.writeHead(401, { "www-authenticate": "Basic" }).end();
    } else if (req.url === "/missing") {
      res.writeHead(404).end();
    } else if (req.url === "/redirect") {
      res.writeHead(302, { location: "http://evil.example/" }).end();
    } else if (req.url === "/slow") {
      setTimeout(() => res.writeHead(200).end("late"), 500);
    } else {
      res.writeHead(200, { "content-type": "text/html" }).end("<html>shop</html>");
    }
  });
  await new Promise<void>((resolve) => target.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(target.address() as AddressInfo).port}`;
});

after(async () => {
  target.closeAllConnections();
  await new Promise<void>((resolve) => target.close(() => resolve()));
});

function config(overrides: Partial<RunnerConfig> = {}): RunnerConfig {
  return {
    host: "127.0.0.1",
    port: 0,
    logLevel: "silent",
    allowedHosts: parseAllowedHosts("127.0.0.1"),
    connectivityTimeoutMs: 2000,
    ...overrides,
  };
}

const okBrowser = () => ({ ok: true, detail: "Chromium 준비됨" });

async function check(targetUrl: unknown, cfg = config()) {
  const app = buildApp({ config: cfg, browserStatus: okBrowser, logger: false });
  const res = await app.inject({ method: "POST", url: "/internal/v1/connectivity-checks", payload: { targetUrl } });
  await app.close();
  return res;
}

test("runnerHealth", async () => {
  const app = buildApp({ config: config(), browserStatus: okBrowser, logger: false });
  const res = await app.inject({ method: "GET", url: "/internal/v1/healthz" });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), { status: "ok" });
  await app.close();
});

test("runnerReady: 브라우저 없으면 503, 실행 중이면 503, 유휴이고 브라우저 있으면 200", async () => {
  const slot = new ExecutionSlot();
  let browserOk = false;
  const app = buildApp({
    config: config(),
    slot,
    browserStatus: () => ({ ok: browserOk, detail: browserOk ? "Chromium 준비됨" : "Chromium이 설치되어 있지 않아요" }),
    logger: false,
  });
  let res = await app.inject({ method: "GET", url: "/internal/v1/readyz" });
  assert.equal(res.statusCode, 503);
  assert.match(res.json<{ checks: { browser: string } }>().checks.browser, /설치/);

  browserOk = true;
  res = await app.inject({ method: "GET", url: "/internal/v1/readyz" });
  assert.equal(res.statusCode, 200);

  assert.equal(slot.tryAcquire("e1"), true);
  assert.equal(slot.tryAcquire("e2"), false);
  res = await app.inject({ method: "GET", url: "/internal/v1/readyz" });
  assert.equal(res.statusCode, 503);
  slot.release("e1");
  res = await app.inject({ method: "GET", url: "/internal/v1/readyz" });
  assert.equal(res.statusCode, 200);
  await app.close();
});

test("checkTargetConnectivity: 정상 응답", async () => {
  const res = await check(`${base}/`);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), { reachable: true, statusCode: 200, message: "대상 사이트에 접속했어요" });
});

test("checkTargetConnectivity: 5xx는 도달 불가, 상태 코드와 사유를 준다", async () => {
  const body = (await check(`${base}/fail`)).json<{ reachable: boolean; statusCode: number; message: string }>();
  assert.equal(body.reachable, false);
  assert.equal(body.statusCode, 503);
  assert.match(body.message, /503/);
});

test("checkTargetConnectivity: 4xx는 서버가 응답했으므로 도달 가능 (ADR-019)", async () => {
  for (const [path, code] of [
    ["/auth", 401],
    ["/missing", 404],
  ] as const) {
    const body = (await check(`${base}${path}`)).json<{ reachable: boolean; statusCode: number; message: string }>();
    assert.equal(body.reachable, true, path);
    assert.equal(body.statusCode, code);
    assert.match(body.message, new RegExp(String(code)));
  }
});

test("checkTargetConnectivity: 리다이렉트는 따라가지 않는다", async () => {
  const before = requests;
  const body = (await check(`${base}/redirect`)).json<{ reachable: boolean; statusCode: number }>();
  assert.equal(body.reachable, true);
  assert.equal(body.statusCode, 302);
  assert.equal(requests, before + 1);
});

test("checkTargetConnectivity: 허용되지 않은 호스트는 요청하지 않고 거부", async () => {
  const before = requests;
  const res = await check(`${base}/`, config({ allowedHosts: parseAllowedHosts("shop.local") }));
  assert.equal(res.statusCode, 200);
  const body = res.json<{ reachable: boolean; statusCode: number | null; message: string }>();
  assert.equal(body.reachable, false);
  assert.equal(body.statusCode, null);
  assert.match(body.message, /RUNNER_ALLOWED_TARGET_HOSTS/);
  assert.equal(requests, before);
});

test("checkTargetConnectivity: 연결 거부와 시간 초과", async () => {
  const closed = createServer();
  await new Promise<void>((resolve) => closed.listen(0, "127.0.0.1", resolve));
  const port = (closed.address() as AddressInfo).port;
  await new Promise<void>((resolve) => closed.close(() => resolve()));

  const refused = (await check(`http://127.0.0.1:${port}/`)).json<{ reachable: boolean; message: string }>();
  assert.equal(refused.reachable, false);
  assert.match(refused.message, /거부/);

  const slow = (await check(`${base}/slow`, config({ connectivityTimeoutMs: 100 }))).json<{
    reachable: boolean;
    message: string;
  }>();
  assert.equal(slow.reachable, false);
  assert.match(slow.message, /응답이 없어요/);
});

test("checkTargetConnectivity: 입력 오류는 400 problem+json", async () => {
  for (const payload of [{}, { targetUrl: "" }, { targetUrl: 3 }, { targetUrl: "not a url" }]) {
    const app = buildApp({ config: config(), browserStatus: okBrowser, logger: false });
    const res = await app.inject({ method: "POST", url: "/internal/v1/connectivity-checks", payload });
    assert.equal(res.statusCode, 400, JSON.stringify(payload));
    assert.match(res.headers["content-type"] as string, /application\/problem\+json/);
    assert.equal(res.json<{ code: string }>().code, "INVALID_REQUEST");
    await app.close();
  }
  const bad = (await check("ftp://127.0.0.1/")).json<{ reachable: boolean }>();
  assert.equal(bad.reachable, false);
});

test("없는 경로는 404 problem+json, 코드 실행 API는 없다", async () => {
  const app = buildApp({ config: config(), browserStatus: okBrowser, logger: false });
  const res = await app.inject({ method: "POST", url: "/internal/v1/eval", payload: { code: "1" } });
  assert.equal(res.statusCode, 404);
  await app.close();
});

test("판정 표 (runner-api checkTargetConnectivity)", async () => {
  const { judge } = await import("../src/connectivity.js");
  assert.deepEqual(
    [200, 204, 301, 302, 400, 401, 403, 404, 429, 499, 500, 502, 503, 599].map((s) => [s, judge(s).reachable]),
    [
      [200, true], [204, true], [301, true], [302, true], [400, true], [401, true], [403, true],
      [404, true], [429, true], [499, true], [500, false], [502, false], [503, false], [599, false],
    ],
  );
  for (const s of [200, 404, 503]) assert.equal(judge(s).statusCode, s);
});
