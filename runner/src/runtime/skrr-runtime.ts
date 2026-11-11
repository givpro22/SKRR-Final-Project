/**
 * TestQuery 동작을 Playwright로 수행하는 런타임. 렌더링한 spec(tc-xx.spec.ts)이 이 파일을 불러 실행한다 (ADR-005).
 * 실행기는 실행마다 spec과 이 파일을 임시 디렉터리에 복사해 @playwright/test로 돌리므로, 이 파일은 다른 소스 파일을
 * import하지 않는다 (타입 import 제외).
 *
 * - 값은 {{이름}} 치환으로 실행 때 넣는다 (변수 → 비밀 변수 → 앞 단계 캡처). spec 문자열에는 값이 없다.
 * - 치환 뒤 경로를 다시 검사해 같은 출처를 벗어나면 실패 처리한다 (스키마는 치환 전 값만 보므로).
 * - 이벤트·결과·로그의 비밀값은 ***로 가린다 (원문, JSON·URL·base64 인코딩 형태 모두).
 * - 허용 목록 밖 요청은 브라우저 라우팅에서 막는다.
 */
import { appendFileSync, readFileSync } from "node:fs";
import type { APIRequestContext, APIResponse, Page, Response, Route } from "@playwright/test";
import { expect } from "@playwright/test";
import { Ajv2020 } from "ajv/dist/2020.js";
import type { ApiCallRecord, ApiCheck, FailureType, HttpMethod, StepKind, StepResult } from "../testQuery.js";

export const FORBIDDEN_HEADERS = new Set(["host", "content-length", "connection", "cookie"]);
const VAR = /\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g;
export const MASK = "***";

/** 비밀값이 문서·로그에 나타날 수 있는 형태: 원문, JSON 문자열 안, URL 인코딩(%20, +), base64 */
export function secretForms(secret: string): string[] {
  if (secret.length < 3) return [];
  const json = JSON.stringify(secret).slice(1, -1);
  const url = encodeURIComponent(secret);
  return [...new Set([secret, json, url, url.replace(/%20/g, "+"), Buffer.from(secret, "utf8").toString("base64")])].sort(
    (a, b) => b.length - a.length,
  );
}

/** 비밀값의 모든 형태를 ***로 바꾼다. 실행기의 HAR·trace 가림과 같은 함수다 */
export function maskText(text: string, secrets: Iterable<string>): string {
  let out = text;
  for (const secret of secrets) for (const form of secretForms(secret)) out = out.split(form).join(MASK);
  return out;
}

export interface AllowedHostLite {
  hostname: string;
  port: number | null;
}

function hostAllowed(raw: string, allowed: AllowedHostLite[]): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return true; // data:, blob: 등 네트워크가 아닌 것
  const port = url.port ? Number(url.port) : url.protocol === "https:" ? 443 : 80;
  return allowed.some((h) => h.hostname === url.hostname.toLowerCase() && (h.port === null || h.port === port));
}

/** waitForApi 경로: {이름}(중괄호 하나) 세그먼트는 '/'가 없는 비어 있지 않은 세그먼트 하나와 맞는다 (계약) */
export function apiPathPattern(path: string): RegExp {
  const parts = path.split(/\{[A-Za-z_][A-Za-z0-9_]*\}/);
  const escaped = parts.map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return new RegExp(`^${escaped.join("[^/]+")}$`);
}

/** 실패 유형이 정해진 오류. 런타임이 던지고 실행 엔진이 결과로 바꾼다. */
export class StepFailure extends Error {
  constructor(
    readonly failureType: FailureType,
    message: string,
    readonly extra: Partial<Pick<StepResult, "expectedValue" | "actualValue" | "schemaCheck" | "schemaErrors">> = {},
  ) {
    super(message);
    this.name = "StepFailure";
  }
}

export type RuntimeEvent =
  | { type: "step"; data: StepResult }
  | { type: "api.call"; data: ApiCallRecord }
  | { type: "screenshot"; data: { stepId: string; order: number; name: string; pagePath: string } }
  | { type: "log"; data: { kind: StepKind; message: string } }
  // 아래는 실행기 내부용이다. 백엔드로 보내지 않는다
  | { type: "internal.failure"; data: { order: number; failureType: FailureType; message: string } }
  | { type: "internal.capture"; data: { name: string; value: string } }
  | { type: "internal.secret"; data: { value: string } }
  | { type: "internal.console"; data: { message: string } }
  | { type: "internal.browser"; data: { version: string } };

export interface RuntimeOptions {
  baseUrl: string;
  variables: Record<string, string>;
  secretVariables: Record<string, string>;
  secretCaptures: string[];
  /** 스크린샷을 저장할 디렉터리. 없으면 찍지 않는다 */
  artifactsDir?: string;
  /** 단계 하나의 동작 시간 제한 (ms) */
  actionTimeoutMs?: number;
  /** 있으면 이 호스트 밖 요청을 브라우저 라우팅에서 막는다 */
  allowedHosts?: AllowedHostLite[];
  emit: (event: RuntimeEvent) => void;
}

const ajv = new Ajv2020({ allErrors: true, strict: false });

export class SkrrRuntime {
  readonly captures: Record<string, string> = {};
  readonly results: StepResult[] = [];
  readonly apiCalls: ApiCallRecord[] = [];
  private readonly origin: string;
  private current: StepResult | null = null;
  private readonly ready: Promise<void>;
  private readonly requestStarted = new WeakMap<object, number>();
  /** 메인 프레임의 화면 이동이 시작됐으면 그 문서의 load를 기다리는 약속 */
  private pendingLoad: Promise<unknown> | null = null;

  constructor(
    readonly page: Page,
    readonly request: APIRequestContext,
    readonly options: RuntimeOptions,
  ) {
    this.origin = new URL(options.baseUrl).origin;
    const timeout = options.actionTimeoutMs ?? 10_000;
    page.setDefaultTimeout(timeout);
    page.setDefaultNavigationTimeout(timeout * 2);
    const isApi = (r: { resourceType(): string; url(): string }) =>
      ["fetch", "xhr"].includes(r.resourceType()) && new URL(r.url()).origin === this.origin;
    page.on("request", (req) => {
      this.requestStarted.set(req, Date.now());
      // 화면 이동 요청이 나가면 새 문서의 load까지 기다릴 수 있게 한다 (Q-M3-1: 로그인 뒤 location.href).
      // 그 이동이 실패·취소되면(다른 이동이 덮어씀 등) 바로 끝낸다. 최대 동작 시간 제한만큼만 기다린다.
      if (req.isNavigationRequest() && req.frame() === page.mainFrame()) {
        this.pendingLoad = new Promise<void>((resolve) => {
          const done = () => {
            clearTimeout(timer);
            page.off("load", done);
            page.off("requestfailed", onFailed);
            page.off("close", done);
            resolve();
          };
          const onFailed = (failed: unknown) => {
            if (failed === req) done();
          };
          const timer = setTimeout(done, timeout);
          page.once("load", done);
          page.on("requestfailed", onFailed);
          page.once("close", done);
        });
      }
    });
    // 화면이 부른 업무 API(fetch·XHR)를 api.call로 남긴다 (UI-03 API 호출 탭). 시간은 요청 시작부터 응답 끝까지
    page.on("requestfinished", (req) => {
      if (!isApi(req)) return;
      const started = this.requestStarted.get(req) ?? Date.now();
      void req.response().then((res) => this.record(req.method(), req.url(), res?.status() ?? 0, Date.now() - started));
    });
    page.on("console", (msg) => {
      if (msg.type() !== "error") return;
      const text = this.mask(msg.text()).slice(0, 500);
      this.options.emit({ type: "internal.console", data: { message: text } });
      this.log("UI", `콘솔 오류: ${text}`);
    });
    const version = page.context().browser()?.version();
    if (version) options.emit({ type: "internal.browser", data: { version: `Chromium ${version}` } });
    const allowed = options.allowedHosts;
    this.ready = allowed
      ? page
          .context()
          .route("**/*", (route) =>
            hostAllowed(route.request().url(), allowed) ? route.fallback() : route.abort("blockedbyclient"),
          )
          .then(() => undefined)
      : Promise.resolve();
  }

  // --- 값과 비밀값 ---

  /** 로그·이벤트·결과에 넣기 전에 비밀값을 가린다 */
  mask(text: string): string {
    return maskText(text, [
      ...Object.values(this.options.secretVariables),
      ...this.options.secretCaptures.map((n) => this.captures[n]).filter((v): v is string => !!v),
    ]);
  }

  /** 캡처를 저장하고, 비밀 캡처면 실행기가 증거에서 가릴 수 있게 값만 따로 알린다 */
  private capture(name: string, value: string): void {
    this.captures[name] = value;
    if (this.options.secretCaptures.includes(name)) {
      this.options.emit({ type: "internal.secret", data: { value } });
    } else {
      this.options.emit({ type: "internal.capture", data: { name, value: this.mask(value) } });
    }
  }

  /** 클릭 등이 화면 이동을 일으켰으면 새 문서가 뜰 때까지 기다린다 (다음 단계가 이동과 겹치지 않게) */
  private async settle(): Promise<void> {
    await this.page.waitForTimeout(150);
    const pending = this.pendingLoad;
    this.pendingLoad = null;
    if (pending) await pending;
  }

  /** {{이름}} 치환. 변수 → 비밀 변수 → 캡처 순. 없으면 TEST_CODE_ERROR (가드를 통과했으면 생기지 않는다) */
  value(text: string): string {
    return text.replace(VAR, (_m, name: string) => {
      const v = this.options.variables[name] ?? this.options.secretVariables[name] ?? this.captures[name];
      if (v === undefined) throw new StepFailure("TEST_CODE_ERROR", `값이 없는 변수 {{${name}}}를 썼어요`);
      return v;
    });
  }

  /** 같은 출처 경로만 허용. 치환 뒤 //host나 다른 호스트로 바뀌면 실패 */
  url(path: string): string {
    const resolved = this.value(path);
    if (!resolved.startsWith("/") || resolved.startsWith("//")) {
      throw new StepFailure("TEST_CODE_ERROR", "치환한 경로가 같은 사이트 경로가 아니에요");
    }
    const url = new URL(resolved, this.origin);
    if (url.origin !== this.origin) throw new StepFailure("TEST_CODE_ERROR", "치환한 경로가 대상 사이트 밖을 가리켜요");
    return url.toString();
  }

  private body(value: unknown): unknown {
    if (typeof value === "string") return this.value(value);
    if (Array.isArray(value)) return value.map((v) => this.body(v));
    if (value && typeof value === "object") {
      return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, this.body(v)]));
    }
    return value;
  }

  private headers(headers: Record<string, string> | undefined): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [name, raw] of Object.entries(headers ?? {})) {
      if (FORBIDDEN_HEADERS.has(name.toLowerCase())) {
        throw new StepFailure("TEST_CODE_ERROR", `${name} 헤더는 쓸 수 없어요`);
      }
      out[name] = this.value(raw);
    }
    return out;
  }

  // --- 단계 ---

  async step(order: number, stepId: string, kind: StepKind, title: string, run: () => Promise<void>): Promise<void> {
    const started = Date.now();
    await this.ready;
    const result: StepResult = { stepId, order, kind, title: this.mask(title), status: "RUNNING" };
    this.current = result;
    this.options.emit({ type: "step", data: { ...result } });
    try {
      await run();
      result.status = "PASSED";
    } catch (err) {
      const failure = classify(err);
      result.status = "FAILED";
      result.detail = this.mask(failure.message).slice(0, 2000);
      for (const [k, v] of Object.entries(failure.extra)) {
        (result as unknown as Record<string, unknown>)[k] = typeof v === "string" ? this.mask(v) : v;
      }
      this.options.emit({ type: "internal.failure", data: { order, failureType: failure.failureType, message: result.detail } });
      throw Object.assign(failure, { message: result.detail });
    } finally {
      result.durationMs = Date.now() - started;
      this.results.push(result);
      this.options.emit({ type: "step", data: { ...result } });
      this.current = null;
      await this.screenshot(order, stepId);
    }
  }

  private async screenshot(order: number, stepId: string): Promise<void> {
    if (!this.options.artifactsDir || this.page.isClosed()) return;
    const name = `step-${order}.png`;
    try {
      await this.page.screenshot({ path: `${this.options.artifactsDir}/${name}`, timeout: 5_000 });
      const pagePath = this.page.url().startsWith(this.origin) ? new URL(this.page.url()).pathname : "";
      this.options.emit({ type: "screenshot", data: { stepId, order, name, pagePath } });
    } catch {
      this.log("UI", `단계 ${order} 화면을 찍지 못했어요`);
    }
  }

  log(kind: StepKind, message: string): void {
    this.options.emit({ type: "log", data: { kind, message: this.mask(message) } });
  }

  private set(extra: Partial<StepResult>): void {
    if (this.current) Object.assign(this.current, extra);
  }

  // --- UI 동작 ---

  async goto(path: string): Promise<void> {
    const url = this.url(path);
    // 앞 단계가 일으킨 화면 이동(예: 로그인 응답 뒤 location.href)이 아직 진행 중이면 먼저 끝까지 기다린다
    if (this.pendingLoad) await this.settle();
    // 그래도 겹치면 그 이동이 끝나기를 기다렸다 다시 시도한다
    for (let attempt = 1; ; attempt++) {
      try {
        await this.page.goto(url);
        this.pendingLoad = null;
        return;
      } catch (err) {
        const interrupted = /interrupted by another navigation|net::ERR_ABORTED/.test(String((err as Error).message));
        if (!interrupted || attempt >= 3) throw err;
        await this.page.waitForLoadState("load").catch(() => undefined);
        await this.page.waitForTimeout(300);
      }
    }
  }

  async click(testId: string): Promise<void> {
    await this.page.getByTestId(testId).click();
    await this.settle();
  }

  async fill(testId: string, value: string): Promise<void> {
    await this.page.getByTestId(testId).fill(this.value(value));
  }

  async selectOption(testId: string, value: string): Promise<void> {
    await this.page.getByTestId(testId).selectOption(this.value(value));
  }

  async press(testId: string, key: string): Promise<void> {
    await this.page.getByTestId(testId).press(key);
    await this.settle();
  }

  async expectVisible(testId: string, visible = true): Promise<void> {
    this.set({ expectedValue: visible ? "보임" : "숨김" });
    const locator = this.page.getByTestId(testId);
    if (visible) await expect(locator).toBeVisible();
    else await expect(locator).toBeHidden();
  }

  async expectText(testId: string, text: string, match: "EXACT" | "CONTAINS" = "CONTAINS"): Promise<void> {
    const expected = this.value(text);
    this.set({ expectedValue: expected });
    const locator = this.page.getByTestId(testId);
    try {
      if (match === "EXACT") await expect(locator).toHaveText(expected);
      else await expect(locator).toContainText(expected);
    } catch (err) {
      const actual = await this.readValue(testId, 500).catch(() => null);
      if (actual !== null) this.set({ actualValue: actual });
      throw err;
    }
  }

  async expectCount(testId: string, count: number): Promise<void> {
    this.set({ expectedValue: String(count) });
    const locator = this.page.getByTestId(testId);
    try {
      await expect(locator).toHaveCount(count);
    } catch (err) {
      this.set({ actualValue: String(await locator.count()) });
      throw err;
    }
  }

  async expectUrl(path: string, match: "EXACT" | "PREFIX" = "PREFIX"): Promise<void> {
    const target = new URL(this.url(path));
    const want = match === "EXACT" ? `${target.pathname}${target.search}` : target.pathname;
    this.set({ expectedValue: want });
    try {
      await expect
        .poll(() => {
          const u = new URL(this.page.url());
          return u.origin === this.origin && (match === "EXACT" ? `${u.pathname}${u.search}` === want : u.pathname.startsWith(want));
        })
        .toBe(true);
    } catch {
      const u = new URL(this.page.url());
      this.set({ actualValue: `${u.pathname}${u.search}` });
      throw new StepFailure("ASSERTION_FAILED", `현재 경로가 ${want}${match === "PREFIX" ? "로 시작하지" : "와 같지"} 않아요`);
    }
  }

  /** 화면 값 읽기: input·textarea·select는 입력값(inputValue), 그 밖은 글자(textContent) (Q-M3-7) */
  private async readValue(testId: string, timeout?: number): Promise<string> {
    const locator = this.page.getByTestId(testId);
    const tag = await locator.evaluate((el: { tagName: string }) => el.tagName.toLowerCase(), undefined, timeout !== undefined ? { timeout } : undefined);
    if (tag === "input" || tag === "textarea" || tag === "select") {
      return (await locator.inputValue(timeout !== undefined ? { timeout } : undefined)).trim();
    }
    return ((await locator.textContent(timeout !== undefined ? { timeout } : undefined)) ?? "").trim();
  }

  async captureText(testId: string, as: string): Promise<void> {
    this.capture(as, await this.readValue(testId));
    this.set({ actualValue: this.mask(this.captures[as] ?? "") });
  }

  expectCapture(capture: string, equals: string): void {
    const expected = this.value(equals);
    const actual = this.captures[capture];
    this.set({ expectedValue: expected, actualValue: actual ?? "(캡처 없음)" });
    if (actual === undefined) throw new StepFailure("TEST_CODE_ERROR", `'${capture}'를 캡처한 단계가 없어요`);
    if (actual !== expected) {
      throw new StepFailure("ASSERTION_FAILED", `캡처 '${capture}' 값이 기대값과 달라요`, { expectedValue: expected, actualValue: actual });
    }
  }

  // --- API 동작 ---

  private record(method: string, url: string, status: number, durationMs: number): void {
    const u = new URL(url);
    const call: ApiCallRecord = {
      method,
      path: this.mask(u.pathname + u.search),
      statusCode: status,
      durationMs: Math.max(0, Math.round(durationMs)),
      occurredAt: new Date().toISOString(),
    };
    this.apiCalls.push(call);
    this.options.emit({ type: "api.call", data: call });
  }

  /**
   * 화면 동작(trigger 클릭)이 일으킨 API 응답을 기다려 검사한다.
   * 페이지가 응답 직후 이동하면 브라우저가 응답 본문을 버리므로, 한 번만 쓰는 라우트로 응답을 받아 그대로 돌려준다.
   */
  async waitForApi(method: HttpMethod, path: string, trigger: string, check: ApiCheck): Promise<void> {
    // {{이름}}을 먼저 치환하고, {이름} 자리는 아무 한 세그먼트와 맞춘다
    const target = new URL(this.url(path.replace(/(?<!\{)\{([A-Za-z_][A-Za-z0-9_]*)\}(?!\})/g, "__seg_$1__")));
    const pattern = apiPathPattern(decodeURIComponent(target.pathname).replace(/__seg_([A-Za-z_][A-Za-z0-9_]*)__/g, "{$1}"));
    let resolve!: (r: APIResponse) => void;
    let reject!: (e: unknown) => void;
    const got = new Promise<APIResponse>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    let seen = false;
    const matcher = (url: URL) => url.origin === this.origin && pattern.test(decodeURIComponent(url.pathname));
    const handler = async (route: Route) => {
      if (seen || route.request().method() !== method) return route.fallback();
      seen = true;
      try {
        const response = await route.fetch();
        resolve(response);
        await route.fulfill({ response });
      } catch (err) {
        reject(err);
        await route.abort().catch(() => undefined);
      }
    };
    await this.page.route(matcher, handler);
    try {
      await this.page.getByTestId(trigger).click();
      const timeout = this.options.actionTimeoutMs ?? 10_000;
      let timer: NodeJS.Timeout | undefined;
      const response = await Promise.race([
        got,
        new Promise<never>((_r, rej) => {
          timer = setTimeout(
            () => rej(new StepFailure("TIMEOUT", `${method} ${path} 응답이 ${timeout}ms 안에 오지 않았어요`)),
            timeout,
          );
        }),
      ]).finally(() => clearTimeout(timer));
      await this.checkResponse(response, check);
    } finally {
      await this.page.unroute(matcher, handler).catch(() => undefined);
    }
    await this.settle();
  }

  /** API를 직접 부른다. 브라우저 컨텍스트의 쿠키를 함께 쓴다 */
  async apiRequest(method: HttpMethod, path: string, options: { headers?: Record<string, string>; body?: unknown }, check: ApiCheck): Promise<void> {
    const url = this.url(path);
    const headers = this.headers(options.headers);
    const started = Date.now();
    const response = await this.request.fetch(url, {
      method,
      headers,
      ...(options.body !== undefined ? { data: this.body(options.body) } : {}),
      failOnStatusCode: false,
    });
    this.record(method, url, response.status(), Date.now() - started);
    await this.checkResponse(response, check);
  }

  /** 상태 코드 → 응답 구조 → 캡처 순서로 검사한다 (state-machines "API 검사와 교차 검증 판정") */
  private async checkResponse(response: Response | APIResponse, check: ApiCheck): Promise<void> {
    const status = response.status();
    this.set({ schemaCheck: "NOT_CHECKED" });
    if (check.expectStatus !== undefined) {
      this.set({ expectedValue: String(check.expectStatus), actualValue: String(status) });
      if (status !== check.expectStatus) {
        throw new StepFailure("API_ERROR", `기대한 상태 코드 ${check.expectStatus}가 아니라 ${status}를 받았어요`, {
          expectedValue: String(check.expectStatus),
          actualValue: String(status),
        });
      }
    }
    const needsBody = check.responseSchema !== undefined || Object.keys(check.captures ?? {}).length > 0;
    if (!needsBody) return;
    let body: unknown;
    try {
      const text = await response.text();
      body = text ? JSON.parse(text) : null;
    } catch {
      body = undefined;
    }
    if (check.responseSchema !== undefined) {
      let validate;
      try {
        validate = ajv.compile(check.responseSchema);
      } catch (err) {
        // 스키마 자체를 못 쓰면 대상 사이트 결함이 아니다
        throw new StepFailure("TEST_CODE_ERROR", `응답 스키마를 쓸 수 없어요: ${(err as Error).message}`);
      }
      if (!validate(body)) {
        const errors = (validate.errors ?? []).slice(0, 20).map(describeSchemaError);
        this.set({ schemaCheck: "FAILED", schemaErrors: errors });
        throw new StepFailure("API_SCHEMA_MISMATCH", `응답 구조가 명세와 달라요: ${errors[0] ?? ""}`, {
          schemaCheck: "FAILED",
          schemaErrors: errors,
        });
      }
      this.set({ schemaCheck: "PASSED" });
    }
    for (const [name, path] of Object.entries(check.captures ?? {})) {
      const value = jsonPath(body, path);
      if (value === undefined) {
        throw new StepFailure("ASSERTION_FAILED", `응답에서 ${path} 값을 찾지 못했어요`);
      }
      this.capture(name, typeof value === "string" ? value : JSON.stringify(value));
    }
  }
}

/** $.a.b[0].c 와 $[0].x 정도의 단순 JSONPath */
export function jsonPath(data: unknown, path: string): unknown {
  if (!path.startsWith("$")) return undefined;
  const tokens = path.slice(1).match(/\.[A-Za-z_$][\w$-]*|\[\d+\]|\['[^']+'\]/g) ?? [];
  if (tokens.join("") !== path.slice(1)) return undefined;
  let node: unknown = data;
  for (const t of tokens) {
    if (node === null || node === undefined) return undefined;
    const key = t.startsWith(".") ? t.slice(1) : t.startsWith("['") ? t.slice(2, -2) : Number(t.slice(1, -1));
    node = (node as Record<string | number, unknown>)[key];
  }
  return node;
}

/** 경로와 기대 타입만 쓴다. 응답 값은 넣지 않는다 (비밀값이 섞일 수 있음) */
function describeSchemaError(e: { instancePath: string; keyword: string; params: Record<string, unknown>; message?: string }): string {
  const path = "$" + e.instancePath.replace(/\/(\d+)/g, "[$1]").replace(/\//g, ".");
  if (e.keyword === "required") return `${path}.${String(e.params.missingProperty)} 이 없음`;
  if (e.keyword === "type") return `${path} 는 ${String(e.params.type)}여야 함`;
  if (e.keyword === "additionalProperties") return `${path}.${String(e.params.additionalProperty)} 는 명세에 없는 필드`;
  return `${path} ${e.keyword} 규칙 위반`;
}

/** Playwright·런타임 오류를 실패 유형으로 나눈다 (runner.md 실패 유형 표) */
// eslint-disable-next-line no-control-regex
const ANSI = /\u001b\[[0-9;]*[A-Za-z]/g;

/** Playwright 오류 문구의 색 코드(ANSI)를 지우고, 사유 문장과 call log 첫 줄만 남긴다 (Q-M3-6) */
export function cleanMessage(raw: string): string {
  const lines = raw.replace(ANSI, "").split("\n").map((l) => l.trimEnd());
  const callLog = lines.findIndex((l) => l.trim() === "Call log:");
  const head = (callLog >= 0 ? lines.slice(0, callLog) : lines).filter((l) => l.trim()).slice(0, 4);
  const firstCall = callLog >= 0 ? lines.slice(callLog + 1).find((l) => l.trim()) : undefined;
  return [...head, ...(firstCall ? [`(call log) ${firstCall.trim().replace(/^- /, "")}`] : [])].join("\n");
}

export function classify(err: unknown): StepFailure {
  if (err instanceof StepFailure) return new StepFailure(err.failureType, cleanMessage(err.message), err.extra);
  const e = err as Error & { matcherResult?: unknown };
  const message = cleanMessage(String(e?.message ?? err));
  if (/Test timeout of \d+ms exceeded|Test ended/i.test(message)) return new StepFailure("TIMEOUT", message);
  if (/net::ERR_|ECONNREFUSED|ENOTFOUND|Target page, context or browser has been closed|browser has disconnected/i.test(message)) {
    return new StepFailure("ENVIRONMENT_ERROR", message);
  }
  const notFound = /element\(s\) not found|waiting for getByTestId|strict mode violation/i.test(message);
  if (e?.matcherResult !== undefined || /expect\(/.test(message)) {
    return new StepFailure(notFound && !/toBeHidden/.test(message) ? "ELEMENT_NOT_FOUND" : "ASSERTION_FAILED", message);
  }
  if (notFound) return new StepFailure("ELEMENT_NOT_FOUND", message);
  if (e?.name === "TimeoutError" || /Timeout \d+ms exceeded/.test(message)) return new StepFailure("TIMEOUT", message);
  // 대상 페이지가 스스로 이동해 동작이 끊긴 경우: 대상 사이트 동작의 결과이므로 테스트 코드 오류로 보지 않는다
  if (/interrupted by another navigation/.test(message)) return new StepFailure("ASSERTION_FAILED", message);
  return new StepFailure("TEST_CODE_ERROR", message);
}

/** spec 실행용 설정 파일 (SKRR_RUN_CONFIG). 실행기가 실행마다 임시 디렉터리에 쓴다. 저장소나 spec에는 남지 않는다 */
export interface RunConfigFile {
  baseUrl: string;
  variables: Record<string, string>;
  secretVariables: Record<string, string>;
  secretCaptures: string[];
  artifactsDir: string;
  eventsFile: string;
  actionTimeoutMs?: number;
  allowedHosts: AllowedHostLite[];
}

/**
 * 렌더링한 spec이 부르는 진입점. 이벤트는 eventsFile에 한 줄씩(JSON) 쓴다.
 * API 직접 호출은 브라우저 컨텍스트의 요청 객체(page.request)를 써서 화면 로그인 쿠키를 함께 보낸다.
 */
export function skrrRuntime(page: Page): SkrrRuntime {
  const configPath = process.env.SKRR_RUN_CONFIG;
  if (!configPath) throw new StepFailure("TEST_CODE_ERROR", "SKRR_RUN_CONFIG가 없어요. 이 spec은 실행기만 실행한다");
  const config = JSON.parse(readFileSync(configPath, "utf8")) as RunConfigFile;
  return new SkrrRuntime(page, page.request, {
    ...config,
    emit: (event) => appendFileSync(config.eventsFile, JSON.stringify({ ...event, occurredAt: new Date().toISOString() }) + "\n"),
  });
}
