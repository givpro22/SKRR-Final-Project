/**
 * TestQuery → Playwright spec (renderSpec, FR-04, WBS 4.6.1, ADR-005).
 *
 * - 결정적: 입력이 같으면 항상 같은 코드.
 * - 모든 입력 값은 JSON.stringify로만 코드에 넣는다 (문자열 이어 붙이기로 넣으면 코드 주입이 가능하다).
 *   주석에는 형식이 검사된 testCaseCode만 넣는다.
 * - 테스트 데이터 값은 spec에 없다. {{이름}}은 실행할 때 런타임(skrr-runtime)이 채운다.
 * - dbChecks, crossChecks는 변환하지 않는다 (백엔드가 처리).
 */
import type { ApiCheck, Step, TestQuery } from "../testQuery.js";
import { stepKind } from "../testQuery.js";

export const RENDERER_VERSION = "1.1.0";

const q = (value: unknown): string => JSON.stringify(value);

function check(step: ApiCheck): string {
  const out: ApiCheck = {};
  if (step.expectStatus !== undefined) out.expectStatus = step.expectStatus;
  if (step.captures && Object.keys(step.captures).length) out.captures = step.captures;
  if (step.responseSchema) out.responseSchema = step.responseSchema;
  return q(out);
}

function action(step: Step): string {
  switch (step.action) {
    case "goto":
      return `await rt.goto(${q(step.path)});`;
    case "click":
      return `await rt.click(${q(step.testId)});`;
    case "fill":
      return `await rt.fill(${q(step.testId)}, ${q(step.value)});`;
    case "selectOption":
      return `await rt.selectOption(${q(step.testId)}, ${q(step.value)});`;
    case "press":
      return `await rt.press(${q(step.testId)}, ${q(step.key)});`;
    case "expectVisible":
      return `await rt.expectVisible(${q(step.testId)}, ${q(step.visible ?? true)});`;
    case "expectText":
      return `await rt.expectText(${q(step.testId)}, ${q(step.text)}, ${q(step.match ?? "CONTAINS")});`;
    case "expectCount":
      return `await rt.expectCount(${q(step.testId)}, ${q(step.count)});`;
    case "expectUrl":
      return `await rt.expectUrl(${q(step.path)}, ${q(step.match ?? "PREFIX")});`;
    case "captureText":
      return `await rt.captureText(${q(step.testId)}, ${q(step.as)});`;
    case "waitForApi":
      return `await rt.waitForApi(${q(step.method)}, ${q(step.path)}, ${q(step.trigger)}, ${check(step)});`;
    case "apiRequest": {
      const options: { headers?: Record<string, string>; body?: unknown } = {};
      if (step.headers) options.headers = step.headers;
      if (step.body !== undefined) options.body = step.body;
      return `await rt.apiRequest(${q(step.method)}, ${q(step.path)}, ${q(options)}, ${check(step)});`;
    }
    case "expectCapture":
      return `rt.expectCapture(${q(step.capture)}, ${q(step.equals)});`;
  }
}

export interface Rendered {
  specSource: string;
  fileName: string;
  rendererVersion: string;
}

export function fileNameFor(testQuery: Pick<TestQuery, "testCaseCode">): string {
  return `${testQuery.testCaseCode.toLowerCase()}.spec.ts`;
}

export function renderSpec(testQuery: TestQuery): Rendered {
  const lines = [
    `// ${fileNameFor(testQuery)} — SKRR renderer ${RENDERER_VERSION}가 TestQuery ${testQuery.testCaseCode}에서 만든 코드다. 직접 고치지 않는다.`,
    "// 테스트 데이터 값은 이 파일에 없다. {{이름}}은 실행할 때 런타임이 채우고, 비밀값은 로그와 결과에서 가린다.",
    'import { test } from "@playwright/test";',
    'import { skrrRuntime } from "./skrr-runtime";',
    "",
    `test(${q(`${testQuery.testCaseCode} ${testQuery.title}`)}, async ({ page }) => {`,
    "  const rt = skrrRuntime(page);",
  ];
  testQuery.steps.forEach((step, i) => {
    lines.push(`  await rt.step(${i + 1}, ${q(step.id)}, ${q(stepKind(step))}, ${q(step.description)}, async () => {`);
    lines.push(`    ${action(step)}`);
    lines.push("  });");
  });
  lines.push("});", "");
  return { specSource: lines.join("\n"), fileName: fileNameFor(testQuery), rendererVersion: RENDERER_VERSION };
}
