// OpenAPI 명세에서 API 타입을 생성한다. 응답·요청 타입을 손으로 쓰지 않기 위해서다.
// format: binary 필드는 브라우저에서 File/Blob으로 다루므로 Blob 타입으로 바꾼다.
// 사용: node scripts/generate-api.mjs [--check]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import openapiTS, { astToString } from "openapi-typescript";
import ts from "typescript";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const specPath = path.resolve(root, "../docs/contracts/platform-api.openapi.yaml");
const outPath = path.resolve(root, "src/api/schema.d.ts");

const BLOB = ts.factory.createTypeReferenceNode(ts.factory.createIdentifier("Blob"));

const ast = await openapiTS(new URL(`file://${specPath}`), {
  transform(schemaObject) {
    if (schemaObject.format === "binary") return BLOB;
    return undefined;
  },
});
const header =
  "/**\n * 이 파일은 자동 생성된다. 직접 고치지 말고 `npm run generate:api`를 실행한다.\n * 원본: docs/contracts/platform-api.openapi.yaml\n */\n\n";
const contents = header + astToString(ast);

if (process.argv.includes("--check")) {
  const current = fs.existsSync(outPath) ? fs.readFileSync(outPath, "utf8") : "";
  if (current !== contents) {
    console.error("src/api/schema.d.ts가 명세와 다릅니다. npm run generate:api를 실행하세요.");
    process.exit(1);
  }
  console.log("API 타입이 명세와 일치합니다.");
} else {
  fs.writeFileSync(outPath, contents);
  console.log(`생성됨: ${path.relative(root, outPath)}`);
}
