/**
 * 렌더링한 spec을 @playwright/test로 실행한다 (ADR-005: renderSpec 결과가 곧 실행 코드).
 *
 * 실행마다 임시 작업 디렉터리에 spec, 런타임(skrr-runtime), Playwright 설정, 실행 설정(run.json, 비밀값 포함·0600)을 쓰고
 * Playwright 테스트 러너를 별도 프로세스로 띄운다. 런타임이 이벤트를 events.jsonl에 한 줄씩 쓰면 실행기가 읽어 SSE로 보낸다.
 * 끝나면 작업 파일(비밀값 포함)을 지우고, trace·HAR는 비밀값을 가린 뒤 증거 디렉터리로 옮긴다.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { closeSync, copyFileSync, existsSync, mkdirSync, openSync, readdirSync, readSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AllowedHost } from "../allowlist.js";
import { renderSpec } from "../render/render.js";
import type { RunConfigFile, RuntimeEvent } from "../runtime/skrr-runtime.js";
import type { TestQuery } from "../testQuery.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const RUNNER_ROOT = join(HERE, "..", "..");

/**
 * spec과 함께 쓸 런타임 소스(TypeScript). 개발은 src/runtime, 빌드본은 빌드 때 복사한 dist/runtime의 .ts.
 * spec과 런타임을 둘 다 TypeScript로 두어 Playwright가 같은 방식으로 불러오게 한다.
 */
function runtimeSource(): string {
  const path = join(HERE, "..", "runtime", "skrr-runtime.ts");
  if (!existsSync(path)) throw new Error("skrr-runtime.ts를 찾지 못했어요 (빌드가 dist/runtime에 복사해야 한다)");
  return path;
}

export interface SpecRunInput {
  workDir: string;
  artifactsDir: string;
  testQuery: TestQuery;
  baseUrl: string;
  secretVariables: Record<string, string>;
  allowedHosts: AllowedHost[];
  viewport: { width: number; height: number };
  timeoutMs: number;
  actionTimeoutMs: number;
  onEvent: (event: RuntimeEvent) => void;
  /** 테스트 전용: Playwright CLI 대신 띄울 node 인자 (시간 제한 강제 종료 확인용) */
  command?: string[];
}

export interface SpecRunOutcome {
  exitCode: number | null;
  killed: boolean;
  /** 러너가 남긴 trace.zip 경로 (가리기 전 원본, 작업 디렉터리 안) */
  rawTrace: string | null;
  harPath: string;
  stderrTail: string;
}

export class SpecRun {
  private child: ChildProcess | null = null;
  private killed = false;

  constructor(private readonly input: SpecRunInput) {}

  /** 중단·시간 초과: 프로세스 그룹을 끝낸다 (브라우저 포함). 2초 뒤에도 남아 있으면 강제 종료 */
  kill(): void {
    const child = this.child;
    if (!child?.pid || child.exitCode !== null) return;
    this.killed = true;
    const signal = (s: NodeJS.Signals) => {
      try {
        process.kill(-child.pid!, s);
      } catch {
        child.kill(s);
      }
    };
    signal("SIGTERM");
    setTimeout(() => {
      if (child.exitCode === null) signal("SIGKILL");
    }, 2000).unref();
  }

  async run(): Promise<SpecRunOutcome> {
    const { input } = this;
    const { workDir, artifactsDir } = input;
    mkdirSync(artifactsDir, { recursive: true });
    const rendered = renderSpec(input.testQuery);
    const runtimeFile = runtimeSource();
    writeFileSync(join(workDir, rendered.fileName), rendered.specSource);
    copyFileSync(runtimeFile, join(workDir, "skrr-runtime.ts"));
    symlinkSync(join(RUNNER_ROOT, "node_modules"), join(workDir, "node_modules"), "dir");
    const eventsFile = join(workDir, "events.jsonl");
    writeFileSync(eventsFile, "");
    const harPath = join(workDir, "network.har");
    const config: RunConfigFile = {
      baseUrl: input.baseUrl,
      variables: input.testQuery.variables ?? {},
      secretVariables: input.secretVariables,
      secretCaptures: input.testQuery.secretCaptures ?? [],
      artifactsDir,
      eventsFile,
      actionTimeoutMs: input.actionTimeoutMs,
      allowedHosts: input.allowedHosts,
    };
    writeFileSync(join(workDir, "run.json"), JSON.stringify(config), { mode: 0o600 });
    const playwrightConfig = {
      testDir: ".",
      testMatch: rendered.fileName,
      outputDir: "./out",
      timeout: input.timeoutMs,
      workers: 1,
      retries: 0,
      reporter: [["null"]],
      use: {
        baseURL: input.baseUrl,
        viewport: input.viewport,
        headless: true,
        trace: "on",
        contextOptions: { recordHar: { path: harPath, content: "omit" } },
      },
    };
    writeFileSync(join(workDir, "playwright.config.mjs"), `export default ${JSON.stringify(playwrightConfig)};\n`);

    const args = input.command ?? [join(RUNNER_ROOT, "node_modules", "@playwright", "test", "cli.js"), "test", "--config", "playwright.config.mjs"];
    const child = spawn(process.execPath, args, {
      cwd: workDir,
      env: { ...process.env, SKRR_RUN_CONFIG: join(workDir, "run.json"), FORCE_COLOR: "0", CI: "1" },
      detached: true,
      stdio: ["ignore", "ignore", "pipe"],
    });
    this.child = child;
    let stderr = "";
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr = (stderr + chunk.toString("utf8")).slice(-4000);
    });

    // 이벤트 파일을 읽어 넘긴다 (줄 단위 JSON)
    let offset = 0;
    let carry = "";
    const drain = () => {
      const fd = openSync(eventsFile, "r");
      try {
        const size = statSync(eventsFile).size;
        if (size <= offset) return;
        const buf = Buffer.alloc(size - offset);
        readSync(fd, buf, 0, buf.length, offset);
        offset = size;
        const lines = (carry + buf.toString("utf8")).split("\n");
        carry = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            input.onEvent(JSON.parse(line) as RuntimeEvent);
          } catch {
            // 깨진 줄은 건너뛴다
          }
        }
      } finally {
        closeSync(fd);
      }
    };
    const poll = setInterval(drain, 100);
    const exitCode = await new Promise<number | null>((resolve) => child.on("close", (code) => resolve(code)));
    clearInterval(poll);
    // 러너가 끝나도 남은 브라우저 프로세스가 작업 디렉터리에 쓰지 않도록 프로세스 그룹을 정리한다
    try {
      process.kill(-child.pid!, "SIGKILL");
    } catch {
      // 이미 모두 끝났다
    }
    drain();
    // 비밀값이 든 실행 설정은 바로 지운다
    rmSync(join(workDir, "run.json"), { force: true });
    return { exitCode, killed: this.killed, rawTrace: findFile(join(workDir, "out"), "trace.zip"), harPath, stderrTail: stderr };
  }
}

function findFile(dir: string, name: string): string | null {
  if (!existsSync(dir)) return null;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      const found = findFile(path, name);
      if (found) return found;
    } else if (entry.name === name) {
      return path;
    }
  }
  return null;
}
