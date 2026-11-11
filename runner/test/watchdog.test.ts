/**
 * Q-M3-10: Playwright가 스스로 끝나지 않아도 실행기 전체 시간 제한이 프로세스 그룹(손자 프로세스 포함)을 끊고
 * 실행을 FAILED/TIMEOUT으로 끝낸다. 브라우저 없이 '멈춘 러너'를 흉내 낸다.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { buildApp } from "../src/app.js";
import { parseAllowedHosts } from "../src/allowlist.js";
import { ExecutionManager } from "../src/execution/manager.js";

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

test("멈춘 러너는 timeoutMs + 여유 뒤 프로세스 그룹째 끊기고 FAILED TIMEOUT", async () => {
  const pidFile = join(mkdtempSync(join(tmpdir(), "skrr-wd-")), "pids.json");
  // SIGTERM을 무시하고, 같은 그룹의 손자 프로세스도 하나 띄운 채 멈춘다
  const script = `
    const { spawn } = require("node:child_process");
    const fs = require("node:fs");
    process.on("SIGTERM", () => {});
    const child = spawn(process.execPath, ["-e", "process.on('SIGTERM',()=>{}); setInterval(()=>{}, 1000)"], { stdio: "ignore" });
    fs.writeFileSync(${JSON.stringify(pidFile)}, JSON.stringify([process.pid, child.pid]));
    setInterval(() => {}, 1000);
  `;
  const manager = new ExecutionManager({
    allowedHosts: parseAllowedHosts("127.0.0.1"),
    retentionMs: 30 * 60_000,
    actionTimeoutMs: 1000,
    killGraceMs: 500,
    specCommand: ["-e", script],
  });
  const app = buildApp({
    config: { host: "127.0.0.1", port: 0, logLevel: "silent", allowedHosts: parseAllowedHosts("127.0.0.1"), connectivityTimeoutMs: 1000, artifactRetentionMs: 1_800_000, actionTimeoutMs: 1000 },
    manager,
    logger: false,
  });
  const executionId = randomUUID();
  const started = Date.now();
  const res = await app.inject({
    method: "POST",
    url: "/internal/v1/executions",
    payload: {
      executionId,
      baseUrl: "http://127.0.0.1:9",
      testQuery: { schemaVersion: "1.0", testCaseCode: "TC-01", title: "멈춤", steps: [{ id: "s01", description: "이동", action: "goto", path: "/" }] },
      viewport: { width: 1280, height: 800 },
      timeoutMs: 1000,
    },
  });
  assert.equal(res.statusCode, 202);
  let exec: any;
  for (let i = 0; i < 200; i++) {
    exec = (await app.inject({ method: "GET", url: `/internal/v1/executions/${executionId}` })).json();
    if (!["QUEUED", "RUNNING"].includes(exec.status)) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  const elapsed = Date.now() - started;
  assert.equal(exec.status, "FAILED");
  assert.equal(exec.failureType, "TIMEOUT");
  // timeoutMs(1000) + 여유(500) + SIGKILL 대기(2000) 안에 끝난다
  assert.ok(elapsed < 6000, `${elapsed}ms`);
  assert.ok(existsSync(pidFile));
  const pids = JSON.parse(readFileSync(pidFile, "utf8")) as number[];
  for (const pid of pids) assert.equal(alive(pid), false, `프로세스 ${pid}가 남아 있다`);
  // 끝난 뒤 실행기는 다음 실행을 받는다
  assert.equal(manager.busy, false);
  await app.close();
});
