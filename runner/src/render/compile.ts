/**
 * 렌더링한 spec의 문법·타입 검사 (tsc --noEmit과 같은 검사를 메모리에서 한다).
 * spec을 런타임(skrr-runtime) 옆에 있는 것으로 보고 검사하므로 실제 실행 때와 같은 타입을 쓴다.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const RUNTIME_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "runtime");

const OPTIONS: ts.CompilerOptions = {
  strict: true,
  noEmit: true,
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  skipLibCheck: true,
  // 실행 이미지에는 @types/node(개발 의존성)가 없으므로 node 타입 없이 검사한다
  types: [],
  esModuleInterop: true,
};

// 라이브러리 타입 파일은 한 번만 읽는다 (Playwright 타입이 커서 매번 읽으면 느리다)
const sourceCache = new Map<string, ts.SourceFile>();

export interface CompileResult {
  compileStatus: "PASSED" | "FAILED";
  compileErrors: string[];
}

export function compileSpec(source: string, fileName: string): CompileResult {
  const virtualPath = join(RUNTIME_DIR, fileName);
  const host = ts.createCompilerHost(OPTIONS, true);
  const baseGetSourceFile = host.getSourceFile.bind(host);
  host.getSourceFile = (path, languageVersion, onError, shouldCreate) => {
    if (path === virtualPath) return ts.createSourceFile(path, source, languageVersion, true);
    const cached = sourceCache.get(path);
    if (cached) return cached;
    const file = baseGetSourceFile(path, languageVersion, onError, shouldCreate);
    if (file && path.includes("node_modules")) sourceCache.set(path, file);
    return file;
  };
  const baseFileExists = host.fileExists.bind(host);
  host.fileExists = (path) => path === virtualPath || baseFileExists(path);
  const baseReadFile = host.readFile.bind(host);
  host.readFile = (path) => (path === virtualPath ? source : baseReadFile(path));

  const program = ts.createProgram([virtualPath], OPTIONS, host);
  const diagnostics = ts.getPreEmitDiagnostics(program).filter((d) => !d.file || d.file.fileName === virtualPath);
  const compileErrors = diagnostics.map((d) => {
    const text = ts.flattenDiagnosticMessageText(d.messageText, "\n");
    if (!d.file || d.start === undefined) return text;
    const { line, character } = d.file.getLineAndCharacterOfPosition(d.start);
    return `${fileName}:${line + 1}:${character + 1} ${text}`;
  });
  return { compileStatus: compileErrors.length ? "FAILED" : "PASSED", compileErrors };
}
