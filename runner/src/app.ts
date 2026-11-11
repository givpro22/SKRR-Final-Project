import { createReadStream } from "node:fs";
import { join } from "node:path";
import Fastify, { type FastifyError, type FastifyInstance, type FastifyReply } from "fastify";
import { checkTargetUrl } from "./allowlist.js";
import { chromiumStatus, type BrowserStatus } from "./browser.js";
import type { RunnerConfig } from "./config.js";
import { checkConnectivity, type ConnectivityResult } from "./connectivity.js";
import { ExecutionManager, type Execution, type ExecutionEvent, type ExecutionRequest } from "./execution/manager.js";
import { compileSpec } from "./render/compile.js";
import { renderSpec } from "./render/render.js";
import { validateTestQuery } from "./schema.js";

export interface AppDeps {
  config: RunnerConfig;
  browserStatus?: () => BrowserStatus;
  manager?: ExecutionManager;
  fetchImpl?: typeof fetch;
  logger?: boolean;
}

interface Problem {
  title: string;
  status: number;
  code?: string;
  detail?: string;
}

const PROBLEM_JSON = "application/problem+json";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ARTIFACT_NAME = /^(trace\.zip|network\.har|step-[0-9]{1,3}\.png)$/;
const SSE_HEARTBEAT_MS = 15_000;

const connectivityBody = {
  type: "object",
  required: ["targetUrl"],
  // 계약: targetUrl은 format uri. URL로 읽을 수 없는 문자열은 본문 형식 오류(400)다.
  properties: { targetUrl: { type: "string", format: "uri", minLength: 1, maxLength: 2000 } },
} as const;

const connectivityResponse = {
  type: "object",
  required: ["reachable"],
  properties: {
    reachable: { type: "boolean" },
    statusCode: { type: ["integer", "null"] },
    message: { type: ["string", "null"] },
  },
} as const;

function problem(reply: FastifyReply, status: number, title: string, code?: string, detail?: string): FastifyReply {
  const body: Problem = { title, status, ...(code ? { code } : {}), ...(detail ? { detail } : {}) };
  return reply.status(status).type(PROBLEM_JSON).send(body);
}

/** startExecution 본문 검사. 문제가 있으면 사유 문장 */
function executionRequestError(body: unknown): string | null {
  if (!body || typeof body !== "object") return "본문이 JSON 객체가 아니에요";
  const b = body as Record<string, unknown>;
  if (typeof b.executionId !== "string" || !UUID.test(b.executionId)) return "executionId는 UUID여야 해요";
  if (typeof b.baseUrl !== "string") return "baseUrl이 없어요";
  const vp = b.viewport as Record<string, unknown> | undefined;
  if (!vp || !Number.isInteger(vp.width) || !Number.isInteger(vp.height) || (vp.width as number) < 100 || (vp.height as number) < 100) {
    return "viewport의 width·height는 100 이상 정수여야 해요";
  }
  if (!Number.isInteger(b.timeoutMs) || (b.timeoutMs as number) < 1000 || (b.timeoutMs as number) > 300_000) {
    return "timeoutMs는 1000~300000이어야 해요";
  }
  if (b.secretVariables !== undefined) {
    const sv = b.secretVariables;
    if (!sv || typeof sv !== "object" || Object.values(sv).some((v) => typeof v !== "string")) {
      return "secretVariables는 문자열 값의 객체여야 해요";
    }
  }
  return null;
}

export function buildApp(deps: AppDeps): FastifyInstance {
  const { config } = deps;
  const browserStatus = deps.browserStatus ?? chromiumStatus;
  const manager =
    deps.manager ??
    new ExecutionManager({
      allowedHosts: config.allowedHosts,
      retentionMs: config.artifactRetentionMs,
      actionTimeoutMs: config.actionTimeoutMs,
    });

  // Fastify 기본 요청 로그는 메서드와 경로만 남긴다. 요청 본문은 로그에 넣지 않는다 (비밀값이 섞일 수 있음).
  const app = Fastify({
    logger: deps.logger === false ? false : { level: config.logLevel },
    // JSON 본문의 타입을 몰래 바꾸지 않는다 (숫자 3을 문자열 "3"으로 받아들이지 않게).
    ajv: { customOptions: { coerceTypes: false } },
    bodyLimit: 5 * 1024 * 1024,
  });
  app.addHook("onClose", async () => manager.shutdown());

  app.setErrorHandler((err: FastifyError, _req, reply) => {
    if (err.validation) return problem(reply, 400, "입력값이 올바르지 않아요", "INVALID_REQUEST", err.message);
    const status = err.statusCode && err.statusCode >= 400 && err.statusCode < 500 ? err.statusCode : 500;
    if (status === 500) app.log.error({ err }, "처리하지 못한 오류");
    return problem(reply, status, status === 500 ? "실행기 내부 오류" : err.message);
  });
  app.setNotFoundHandler((_req, reply) => problem(reply, 404, "경로가 없어요"));

  void app.register(
    (api, _opts, done) => {
      // operationId: runnerHealth
      api.get("/healthz", () => ({ status: "ok" }));

      // operationId: runnerReady — 브라우저 기동 가능, 유휴 상태
      api.get("/readyz", (_req, reply) => {
        const browser = browserStatus();
        const idle = !manager.busy;
        const ready = browser.ok && idle;
        return reply.status(ready ? 200 : 503).send({
          status: ready ? "ready" : "not_ready",
          checks: {
            browser: browser.detail,
            idle: idle ? "유휴" : `실행 중 (${manager.activeId})`,
            allowedTargetHosts: config.allowedHosts.length,
          },
        });
      });

      // operationId: checkTargetConnectivity
      api.post<{ Body: { targetUrl: string }; Reply: ConnectivityResult }>(
        "/connectivity-checks",
        { schema: { body: connectivityBody, response: { 200: connectivityResponse } } },
        async (req) =>
          checkConnectivity(req.body.targetUrl, {
            allowedHosts: config.allowedHosts,
            timeoutMs: config.connectivityTimeoutMs,
            ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}),
          }),
      );

      // operationId: renderSpec — TestQuery → spec.ts, 문법·타입 검사. 문법 오류도 200 (compileStatus로 구분)
      api.post<{ Body: { testQuery?: unknown } }>("/specs/render", (req, reply) => {
        const checked = validateTestQuery((req.body as { testQuery?: unknown } | undefined)?.testQuery);
        if (!checked.ok) return problem(reply, 422, "TestQuery가 스키마와 맞지 않아요", "INVALID_TEST_QUERY", checked.errors.slice(0, 10).join("; "));
        const rendered = renderSpec(checked.testQuery);
        const compiled = compileSpec(rendered.specSource, rendered.fileName);
        return reply.send({ ...rendered, ...compiled });
      });

      // operationId: startExecution
      api.post<{ Body: ExecutionRequest }>("/executions", (req, reply) => {
        const shapeError = executionRequestError(req.body);
        if (shapeError) return problem(reply, 422, "실행 요청이 올바르지 않아요", "INVALID_REQUEST", shapeError);
        const body = req.body;
        const checked = validateTestQuery(body.testQuery);
        if (!checked.ok) return problem(reply, 422, "TestQuery가 스키마와 맞지 않아요", "INVALID_TEST_QUERY", checked.errors.slice(0, 10).join("; "));
        const target = checkTargetUrl(body.baseUrl, config.allowedHosts);
        if (!target.ok) return problem(reply, 422, "허용되지 않은 대상이에요", "TARGET_NOT_ALLOWED", target.reason);
        if (manager.has(body.executionId)) return problem(reply, 409, "이미 받은 실행 ID예요", "DUPLICATE_EXECUTION");
        if (manager.busy) return problem(reply, 409, "다른 실행이 진행 중이에요", "RUNNER_BUSY", `진행 중: ${manager.activeId}`);
        const exec = manager.start({ ...body, testQuery: checked.testQuery });
        return reply.status(202).send(exec.toContract());
      });

      api.get<{ Params: { executionId: string } }>("/executions/:executionId", (req, reply) => {
        const exec = manager.get(req.params.executionId);
        return exec ? reply.send(exec.toContract()) : problem(reply, 404, "실행이 없어요", "EXECUTION_NOT_FOUND");
      });

      // operationId: streamExecutionEvents — 지난 이벤트를 먼저 보내고 이어서 보낸다. 끝나면 마지막 status 뒤 닫는다
      api.get<{ Params: { executionId: string } }>("/executions/:executionId/events", (req, reply) => {
        const exec = manager.get(req.params.executionId);
        if (!exec) return problem(reply, 404, "실행이 없어요", "EXECUTION_NOT_FOUND");
        const lastSeen = Number(req.headers["last-event-id"] ?? 0) || 0;
        streamEvents(reply, exec, lastSeen);
        return reply;
      });

      // operationId: getExecutionArtifact
      api.get<{ Params: { executionId: string; name: string } }>("/executions/:executionId/artifacts/:name", (req, reply) => {
        const { executionId, name } = req.params;
        if (!ARTIFACT_NAME.test(name)) return problem(reply, 404, "없는 파일이에요", "ARTIFACT_NOT_FOUND");
        const exec = manager.get(executionId);
        if (!exec) return problem(reply, 404, "실행이 없어요", "EXECUTION_NOT_FOUND");
        const artifact = exec.artifacts().find((a) => a.name === name);
        if (!artifact) {
          const pendingScreenshot = name.startsWith("step-") && !exec.finished;
          const pendingFinal = !name.startsWith("step-") && !exec.finished;
          if (!exec.filesDeleted && (pendingScreenshot || pendingFinal)) {
            return problem(reply, 409, "아직 만들어지지 않은 파일이에요", "ARTIFACT_NOT_READY");
          }
          return problem(reply, 404, "없는 파일이에요 (보관 기간이 지났을 수 있어요)", "ARTIFACT_NOT_FOUND");
        }
        return reply.type(artifact.contentType).send(createReadStream(join(exec.dir, name)));
      });

      // operationId: cancelExecution
      api.post<{ Params: { executionId: string } }>("/executions/:executionId/cancel", async (req, reply) => {
        const exec = manager.get(req.params.executionId);
        if (!exec) return problem(reply, 404, "실행이 없어요", "EXECUTION_NOT_FOUND");
        void manager.cancel(exec);
        return reply.status(202).send({ executionId: exec.id, status: exec.finished ? exec.status : "CANCELLING" });
      });
      done();
    },
    { prefix: "/internal/v1" },
  );

  return app;
}

function streamEvents(reply: FastifyReply, exec: Execution, lastSeen: number): void {
  reply.hijack();
  const res = reply.raw;
  res.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache",
    connection: "keep-alive",
    "x-accel-buffering": "no",
  });
  const write = (e: ExecutionEvent) => {
    res.write(`id: ${e.seq}\nevent: ${e.type}\ndata: ${JSON.stringify({ type: e.type, occurredAt: e.occurredAt, data: e.data })}\n\n`);
  };
  for (const e of exec.events) if (e.seq > lastSeen) write(e);
  if (exec.finished) {
    res.end();
    return;
  }
  const heartbeat = setInterval(() => res.write(": keep-alive\n\n"), SSE_HEARTBEAT_MS);
  const listener = (e: ExecutionEvent) => {
    write(e);
    if (e.type === "status" && exec.finished) close();
  };
  const close = () => {
    clearInterval(heartbeat);
    exec.listeners.delete(listener);
    res.end();
  };
  exec.listeners.add(listener);
  res.on("close", () => {
    clearInterval(heartbeat);
    exec.listeners.delete(listener);
  });
}
