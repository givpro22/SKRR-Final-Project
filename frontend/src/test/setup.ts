import "@testing-library/jest-dom/vitest";
import { Blob as NodeBlob, File as NodeFile } from "node:buffer";
import { cleanup } from "@testing-library/react";
import { afterAll, afterEach, beforeAll } from "vitest";
import { server } from "@/mocks/server";
import { resetMockDb } from "@/mocks/db";

// jsdom의 File·Blob·FormData는 Node fetch(undici)가 multipart 본문으로 읽지 못한다.
// 업로드 요청을 MSW로 검사하려고 테스트에서만 Node 구현으로 바꾼다. 브라우저 동작과는 무관하다.
const NodeFormData = (await new Response(new URLSearchParams()).formData()).constructor;
Object.assign(globalThis, { File: NodeFile, Blob: NodeBlob, FormData: NodeFormData });

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => {
  cleanup();
  server.resetHandlers();
  resetMockDb();
});
afterAll(() => server.close());
