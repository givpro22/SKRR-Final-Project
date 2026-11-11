import { readFileSync } from "node:fs";
import { Ajv2020 } from "ajv/dist/2020.js";
import type { ErrorObject } from "ajv";
import type { TestQuery } from "./testQuery.js";

/** 계약 사본. docs/contracts/schemas/test-query.schema.json과 같은지 test/schema.test.ts가 확인한다. */
export const TEST_QUERY_SCHEMA = JSON.parse(
  readFileSync(new URL("./contracts/test-query.schema.json", import.meta.url), "utf8"),
) as Record<string, unknown>;

const ajv = new Ajv2020({ allErrors: true, strict: false });
const validate = ajv.compile<TestQuery>(TEST_QUERY_SCHEMA);

export function formatErrors(errors: ErrorObject[] | null | undefined): string[] {
  return (errors ?? []).map((e) => `${e.instancePath || "(최상위)"} ${e.message ?? ""}`.trim());
}

export function validateTestQuery(value: unknown): { ok: true; testQuery: TestQuery } | { ok: false; errors: string[] } {
  if (validate(value)) return { ok: true, testQuery: value };
  return { ok: false, errors: formatErrors(validate.errors) };
}
