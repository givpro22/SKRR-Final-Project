import Fastify, { type FastifyInstance, type FastifyError } from "fastify";
import { chromiumStatus, type BrowserStatus } from "./browser.js";
import type { RunnerConfig } from "./config.js";
import { checkConnectivity, type ConnectivityResult } from "./connectivity.js";
import { ExecutionSlot } from "./executionSlot.js";

export interface AppDeps {
  config: RunnerConfig;
  browserStatus?: () => BrowserStatus;
  slot?: ExecutionSlot;
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

export function buildApp(deps: AppDeps): FastifyInstance {
  const { config } = deps;
  const browserStatus = deps.browserStatus ?? chromiumStatus;
  const slot = deps.slot ?? new ExecutionSlot();

  // Fastify 기본 요청 로그는 메서드와 경로만 남긴다. 요청 본문은 로그에 넣지 않는다 (비밀값이 섞일 수 있음).
  const app = Fastify({
    logger: deps.logger === false ? false : { level: config.logLevel },
    // JSON 본문의 타입을 몰래 바꾸지 않는다 (숫자 3을 문자열 "3"으로 받아들이지 않게).
    ajv: { customOptions: { coerceTypes: false } },
  });

  app.setErrorHandler((err: FastifyError, _req, reply) => {
    if (err.validation) {
      const problem: Problem = {
        title: "입력값이 올바르지 않아요",
        status: 400,
        code: "INVALID_REQUEST",
        detail: err.message,
      };
      return reply.status(400).type(PROBLEM_JSON).send(problem);
    }
    const status = err.statusCode && err.statusCode >= 400 && err.statusCode < 500 ? err.statusCode : 500;
    if (status === 500) app.log.error({ err }, "처리하지 못한 오류");
    const problem: Problem = {
      title: status === 500 ? "실행기 내부 오류" : err.message,
      status,
    };
    return reply.status(status).type(PROBLEM_JSON).send(problem);
  });

  app.setNotFoundHandler((_req, reply) => {
    const problem: Problem = { title: "경로가 없어요", status: 404 };
    return reply.status(404).type(PROBLEM_JSON).send(problem);
  });

  void app.register(
    (api, _opts, done) => {
      // operationId: runnerHealth
      api.get("/healthz", () => ({ status: "ok" }));

      // operationId: runnerReady — 브라우저 기동 가능, 유휴 상태
      api.get("/readyz", (_req, reply) => {
        const browser = browserStatus();
        const idle = !slot.busy;
        const ready = browser.ok && idle;
        return reply.status(ready ? 200 : 503).send({
          status: ready ? "ready" : "not_ready",
          checks: {
            browser: browser.detail,
            idle: idle ? "유휴" : `실행 중 (${slot.executionId})`,
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
      done();
    },
    { prefix: "/internal/v1" },
  );

  return app;
}
