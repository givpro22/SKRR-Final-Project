/**
 * 실행 관리: 한 번에 1건(RUNNER_BUSY), 상태·이벤트·증거 보관, 중단과 시간 초과.
 *
 * 증거(스크린샷, trace, HAR)는 실행별 임시 디렉터리에 두고 백엔드가 getExecutionArtifact로 가져간다 (U1).
 * 끝난 실행의 파일은 보관 시간(기본 30분)이 지나면 지운다.
 */
import { existsSync, mkdirSync, mkdtempSync, renameSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AllowedHost } from "../allowlist.js";
import { compileSpec } from "../render/compile.js";
import { renderSpec } from "../render/render.js";
import { maskText, type RuntimeEvent } from "../runtime/skrr-runtime.js";
import type { ApiCallRecord, ExecutionStatus, FailureType, StepResult, TestQuery } from "../testQuery.js";
import { stepKind } from "../testQuery.js";
import { redactTrace, scrubHar } from "./artifacts.js";
import { SpecRun } from "./specRunner.js";

export interface ExecutionRequest {
  executionId: string;
  baseUrl: string;
  testQuery: TestQuery;
  secretVariables?: Record<string, string>;
  viewport: { width: number; height: number };
  timeoutMs: number;
}

export interface ExecutionEvent {
  seq: number;
  type: "status" | "step" | "api.call" | "screenshot" | "log";
  occurredAt: string;
  data: unknown;
}

export interface Artifact {
  kind: "TRACE" | "HAR" | "SCREENSHOT";
  name: string;
  contentType: string;
  sizeBytes?: number;
  stepId?: string;
}

const FINISHED: ReadonlySet<ExecutionStatus> = new Set(["PASSED", "FAILED", "ERROR", "CANCELLED"]);

export class Execution {
  status: ExecutionStatus = "QUEUED";
  readonly startedAt = Date.now();
  finishedAt: number | null = null;
  browserVersion: string | null = null;
  failureType: FailureType | null = null;
  failureMessage: string | null = null;
  readonly steps: StepResult[];
  apiCalls: ApiCallRecord[] = [];
  captures: Record<string, string> = {};
  consoleErrors: string[] = [];
  readonly events: ExecutionEvent[] = [];
  readonly listeners = new Set<(e: ExecutionEvent) => void>();
  readonly screenshots = new Map<string, string>(); // name → stepId
  run: SpecRun | null = null;
  /** 이번 실행에서 가릴 값: secretVariables 값 + 비밀 캡처 값 */
  readonly secrets = new Set<string>();
  /** 런타임이 알린 마지막 실패 */
  failure: { order: number; failureType: FailureType; message: string } | null = null;
  cancelRequested = false;
  timedOut = false;
  filesDeleted = false;

  constructor(
    readonly request: ExecutionRequest,
    /** 증거 파일만 두는 디렉터리 (백엔드가 가져가는 것) */
    readonly dir: string,
    /** spec·설정·이벤트 파일을 두는 작업 디렉터리 (끝나면 지운다) */
    readonly workDir: string,
  ) {
    for (const v of Object.values(request.secretVariables ?? {})) this.secrets.add(v);
    this.steps = request.testQuery.steps.map((s, i) => ({
      stepId: s.id,
      order: i + 1,
      kind: stepKind(s),
      title: s.description,
      status: "PENDING",
    }));
  }

  get id(): string {
    return this.request.executionId;
  }

  get finished(): boolean {
    return FINISHED.has(this.status);
  }

  push(type: ExecutionEvent["type"], data: unknown): void {
    const event: ExecutionEvent = { seq: this.events.length + 1, type, occurredAt: new Date().toISOString(), data };
    this.events.push(event);
    for (const listener of this.listeners) listener(event);
  }

  artifacts(): Artifact[] {
    if (this.filesDeleted) return [];
    const out: Artifact[] = [];
    for (const [name, stepId] of this.screenshots) {
      out.push({ kind: "SCREENSHOT", name, contentType: "image/png", sizeBytes: size(join(this.dir, name)), stepId });
    }
    if (this.finished) {
      for (const [kind, name, contentType] of [
        ["TRACE", "trace.zip", "application/zip"],
        ["HAR", "network.har", "application/json"],
      ] as const) {
        const s = size(join(this.dir, name));
        if (s !== undefined) out.push({ kind, name, contentType, sizeBytes: s });
      }
    }
    return out;
  }

  mask(text: string): string {
    return maskText(text, this.secrets);
  }

  /** runner-api Execution */
  toContract(): Record<string, unknown> {
    const end = this.finishedAt ?? Date.now();
    return {
      executionId: this.id,
      status: this.status,
      durationMs: end - this.startedAt,
      ...(this.browserVersion ? { browserVersion: this.browserVersion } : {}),
      failureType: this.failureType,
      failureMessage: this.failureMessage,
      steps: this.steps,
      apiCalls: this.apiCalls,
      captures: this.captures,
      consoleErrors: this.consoleErrors,
      artifacts: this.artifacts(),
    };
  }
}

function size(path: string): number | undefined {
  try {
    return statSync(path).size;
  } catch {
    return undefined;
  }
}

export interface ManagerOptions {
  allowedHosts: AllowedHost[];
  retentionMs: number;
  actionTimeoutMs: number;
  maxRetained?: number;
  /** Playwright 자체 시간 제한 뒤 실행기가 프로세스 그룹을 강제로 끊기까지의 여유 (기본 15초) */
  killGraceMs?: number;
  /** 테스트 전용: Playwright CLI 대신 띄울 node 인자 */
  specCommand?: string[];
}

/** 실패 유형으로 실행 끝 상태를 정한다. 실행 자체가 안 된 경우(환경·변환 코드)는 ERROR */
export function statusFor(failure: FailureType | null): "PASSED" | "FAILED" | "ERROR" {
  if (!failure) return "PASSED";
  return failure === "ENVIRONMENT_ERROR" || failure === "TEST_CODE_ERROR" ? "ERROR" : "FAILED";
}

export class ExecutionManager {
  private readonly executions = new Map<string, Execution>();
  private active: Execution | null = null;

  constructor(private readonly options: ManagerOptions) {}

  get busy(): boolean {
    return this.active !== null;
  }

  get activeId(): string | null {
    return this.active?.id ?? null;
  }

  get(id: string): Execution | undefined {
    return this.executions.get(id);
  }

  has(id: string): boolean {
    return this.executions.has(id);
  }

  /** 호출 전에 busy와 중복 id를 확인한다 (409). 실행은 백그라운드로 진행한다 */
  start(request: ExecutionRequest): Execution {
    const root = mkdtempSync(join(tmpdir(), "skrr-run-"));
    const dir = join(root, "artifacts");
    const workDir = join(root, "work");
    mkdirSync(dir);
    mkdirSync(workDir);
    const exec = new Execution(request, dir, workDir);
    this.executions.set(exec.id, exec);
    this.active = exec;
    this.evictOld();
    void this.execute(exec, root);
    return exec;
  }

  cancel(exec: Execution): void {
    if (exec.finished || exec.cancelRequested) return;
    exec.cancelRequested = true;
    exec.run?.kill();
  }

  private async execute(exec: Execution, root: string): Promise<void> {
    const { request } = exec;
    exec.status = "RUNNING";
    exec.push("status", { status: "RUNNING" });
    let timer: NodeJS.Timeout | undefined;
    try {
      // renderSpec 결과가 곧 실행 코드다. 실행 전에 같은 문법·타입 검사를 다시 한다 (ADR-005)
      const rendered = renderSpec(request.testQuery);
      const compiled = compileSpec(rendered.specSource, rendered.fileName);
      if (compiled.compileStatus === "FAILED") {
        exec.failure = { order: 0, failureType: "TEST_CODE_ERROR", message: `spec 문법 검사 실패: ${compiled.compileErrors.slice(0, 3).join("; ")}` };
      } else if (!exec.cancelRequested) {
        const run = new SpecRun({
          workDir: exec.workDir,
          artifactsDir: exec.dir,
          testQuery: request.testQuery,
          baseUrl: request.baseUrl,
          secretVariables: request.secretVariables ?? {},
          allowedHosts: this.options.allowedHosts,
          viewport: request.viewport,
          timeoutMs: request.timeoutMs,
          actionTimeoutMs: this.options.actionTimeoutMs,
          onEvent: (event) => this.onRuntimeEvent(exec, event),
          ...(this.options.specCommand ? { command: this.options.specCommand } : {}),
        });
        exec.run = run;
        // Playwright 자체 시간 제한(timeoutMs)이 먼저 걸리고, 그래도 안 끝나면 여유 시간 뒤 프로세스 그룹을 강제로 끊는다
        // (SIGTERM, 2초 뒤 SIGKILL). 이 타이머가 실행기 전체 시간 제한이다 (Q-M3-10)
        timer = setTimeout(() => {
          exec.timedOut = true;
          run.kill();
        }, request.timeoutMs + (this.options.killGraceMs ?? 15_000));
        const outcome = await run.run();
        await this.collectEvidence(exec, outcome.rawTrace, outcome.harPath);
        const elapsed = Date.now() - exec.startedAt;
        if (!exec.cancelRequested && !exec.failure && outcome.exitCode !== 0) {
          // 단계 밖에서 실패함 (spec을 불러오지 못함, 브라우저를 띄우지 못함, 시간 제한 등)
          const timedOut = exec.timedOut || elapsed >= request.timeoutMs;
          exec.failure = timedOut
            ? { order: 0, failureType: "TIMEOUT", message: `실행 시간 제한 ${request.timeoutMs}ms를 넘었어요` }
            : { order: 0, failureType: /browserType\.launch|Executable doesn't exist/.test(outcome.stderrTail) ? "ENVIRONMENT_ERROR" : "TEST_CODE_ERROR", message: `spec 실행에 실패했어요: ${exec.mask(lastLine(outcome.stderrTail))}` };
        } else if (
          exec.failure &&
          (exec.timedOut || elapsed >= request.timeoutMs) &&
          (exec.failure.failureType === "ENVIRONMENT_ERROR" || exec.failure.failureType === "TEST_CODE_ERROR")
        ) {
          // 시간 제한으로 러너가 브라우저를 닫아 진행 중 단계가 '닫힘'·'테스트 시간 초과'로 실패한 경우 (state-machines: FAILED + TIMEOUT)
          exec.failure = { ...exec.failure, failureType: "TIMEOUT", message: `실행 시간 제한 ${request.timeoutMs}ms를 넘었어요` };
        }
      }
      if (exec.cancelRequested) exec.status = "CANCELLED";
      else exec.status = statusFor(exec.failure?.failureType ?? null);
      if (exec.status !== "CANCELLED" && exec.failure) {
        exec.failureType = exec.failure.failureType;
        exec.failureMessage = exec.mask(exec.failure.message);
      }
    } catch (err) {
      exec.status = exec.cancelRequested ? "CANCELLED" : "ERROR";
      if (!exec.cancelRequested) {
        exec.failureType = "ENVIRONMENT_ERROR";
        exec.failureMessage = exec.mask(`실행기 오류: ${(err as Error).message.split("\n")[0]}`);
      }
    } finally {
      clearTimeout(timer);
      this.markRemaining(exec);
      // 정리 실패가 실행을 끝내지 못하게 막으면 안 된다 (실행기가 계속 RUNNER_BUSY가 됨)
      removeQuietly(exec.workDir);
      exec.finishedAt = Date.now();
      exec.run = null;
      if (this.active === exec) this.active = null;
      exec.push("status", {
        status: exec.status,
        ...(exec.failureType ? { failureType: exec.failureType, failureMessage: exec.failureMessage } : {}),
      });
      setTimeout(() => this.deleteFiles(exec, root), this.options.retentionMs).unref();
    }
  }

  /** trace·HAR의 비밀값을 가려 증거 디렉터리로 옮긴다. 가리지 못하면 내주지 않는다 */
  private async collectEvidence(exec: Execution, rawTrace: string | null, harPath: string): Promise<void> {
    const secrets = [...exec.secrets];
    if (rawTrace) {
      const result = await redactTrace(rawTrace, join(exec.dir, "trace.zip"), secrets);
      if (!result.ok) {
        rmSync(join(exec.dir, "trace.zip"), { force: true });
        exec.push("log", { kind: "TEARDOWN", message: `trace를 내주지 않아요: ${result.reason}` });
      }
    }
    if (existsSync(harPath)) {
      if (scrubHar(harPath, secrets)) renameSync(harPath, join(exec.dir, "network.har"));
      else {
        rmSync(harPath, { force: true });
        exec.push("log", { kind: "TEARDOWN", message: "HAR에서 비밀값을 지우지 못해 내주지 않아요" });
      }
    }
  }

  /** 실패·중단 뒤 실행하지 못한 단계는 SKIPPED. 진행 중이던 단계는 FAILED(중단이면 SKIPPED) */
  private markRemaining(exec: Execution): void {
    for (const step of exec.steps) {
      if (step.status === "PENDING" || (step.status === "RUNNING" && exec.cancelRequested)) {
        step.status = "SKIPPED";
        exec.push("step", { ...step });
      } else if (step.status === "RUNNING") {
        step.status = "FAILED";
        step.detail = exec.failureType === "TIMEOUT" ? "실행 시간 제한을 넘어 중단했어요" : step.detail;
        exec.push("step", { ...step });
      }
    }
  }

  private onRuntimeEvent(exec: Execution, event: RuntimeEvent): void {
    switch (event.type) {
      case "internal.secret":
        exec.secrets.add(event.data.value);
        return;
      case "internal.capture":
        exec.captures[event.data.name] = exec.mask(event.data.value);
        return;
      case "internal.console":
        exec.consoleErrors.push(exec.mask(event.data.message));
        return;
      case "internal.browser":
        exec.browserVersion = event.data.version;
        return;
      case "internal.failure":
        exec.failure = event.data;
        return;
      default:
        break;
    }
    if (exec.cancelRequested && event.type !== "log") return;
    if (event.type === "step") {
      const target = exec.steps.find((s) => s.order === event.data.order);
      if (target) Object.assign(target, event.data);
    }
    if (event.type === "api.call") exec.apiCalls.push(event.data);
    if (event.type === "screenshot") exec.screenshots.set(event.data.name, event.data.stepId);
    exec.push(event.type, event.data);
  }

  private deleteFiles(exec: Execution, root?: string): void {
    exec.filesDeleted = true;
    removeQuietly(root ?? join(exec.dir, ".."));
  }

  /** 끝난 실행 기록이 너무 많으면 오래된 것부터 지운다 (파일도 함께) */
  private evictOld(): void {
    const max = this.options.maxRetained ?? 200;
    for (const [id, exec] of this.executions) {
      if (this.executions.size <= max) break;
      if (exec.finished) {
        this.deleteFiles(exec);
        this.executions.delete(id);
      }
    }
  }

  /** 서버 종료 때 진행 중인 실행을 멈추고 임시 파일을 지운다 */
  shutdown(): Promise<void> {
    if (this.active) this.cancel(this.active);
    for (const exec of this.executions.values()) this.deleteFiles(exec);
    return Promise.resolve();
  }
}

/** 디렉터리를 지운다. 동시에 쓰는 파일 때문에 실패하면 몇 번 다시 시도하고, 그래도 안 되면 나중에 한 번 더 시도한다 */
function removeQuietly(path: string): void {
  try {
    rmSync(path, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } catch {
    setTimeout(() => {
      try {
        rmSync(path, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
      } catch {
        // 임시 디렉터리라 OS가 정리한다
      }
    }, 5_000).unref();
  }
}

function lastLine(text: string): string {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  return (lines.at(-1) ?? "").slice(0, 300);
}
