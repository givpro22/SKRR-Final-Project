// 화면 코드를 실제 백엔드(개발 서버 프록시 경유)에 붙여 확인하는 통합 테스트 설정.
// 사용: 백엔드·AI 서버와 Vite 개발 서버를 띄운 뒤
//   INTEGRATION_BASE_URL=http://localhost:5173 INTEGRATION_PROJECT_ID=<uuid> npm run test:integration
import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "jsdom",
    environmentOptions: { jsdom: { url: process.env.INTEGRATION_BASE_URL ?? "http://localhost:5173" } },
    globals: true,
    setupFiles: ["./src/test/integration-setup.ts"],
    include: ["src/**/*.integration.test.tsx"],
    testTimeout: 180_000,
    css: false,
  },
});
