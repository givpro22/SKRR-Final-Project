import { parseAllowedHosts, type AllowedHost } from "./allowlist.js";

export interface RunnerConfig {
  host: string;
  port: number;
  logLevel: string;
  /** RUNNER_ALLOWED_TARGET_HOSTS. 비어 있으면 모든 대상을 거부한다. */
  allowedHosts: AllowedHost[];
  connectivityTimeoutMs: number;
}

function intFrom(value: string | undefined, fallback: number, name: string): number {
  if (value === undefined || value.trim() === "") return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error(`${name} 값이 올바른 양의 정수가 아닙니다: ${value}`);
  }
  return n;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): RunnerConfig {
  return {
    host: env.HOST?.trim() || "0.0.0.0",
    port: intFrom(env.PORT, 3001, "PORT"),
    logLevel: env.LOG_LEVEL?.trim() || "info",
    allowedHosts: parseAllowedHosts(env.RUNNER_ALLOWED_TARGET_HOSTS ?? ""),
    connectivityTimeoutMs: intFrom(env.CONNECTIVITY_TIMEOUT_MS, 10_000, "CONNECTIVITY_TIMEOUT_MS"),
  };
}
