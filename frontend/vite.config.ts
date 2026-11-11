/// <reference types="vitest/config" />
import { rmSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath, URL } from "node:url";
import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

/** Host 헤더의 포트. 없으면 프로토콜 기본 포트. IPv6 주소([::1]:5173)도 처리한다. */
export function forwardedPort(host: string | undefined, proto: "http" | "https"): string {
  const match = host ? /:(\d+)$/.exec(host) : null;
  return match?.[1] ?? (proto === "https" ? "443" : "80");
}

// MSW 워커는 개발 모드 전용이다. public/에서 복사된 파일을 빌드 결과에서 지운다.
function dropMockWorker(): Plugin {
  let outDir = "dist";
  return {
    name: "skrr-drop-mock-worker",
    apply: "build",
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
    },
    closeBundle() {
      rmSync(`${outDir}/mockServiceWorker.js`, { force: true });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  // 개발 서버는 /api 요청을 백엔드로 넘긴다. 브라우저는 백엔드 외의 서비스를 호출하지 않는다 (ADR-009).
  const apiTarget = env.VITE_API_PROXY_TARGET || "http://localhost:8080";

  return {
    plugins: [react(), tailwindcss(), dropMockWorker()],
    resolve: {
      alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
    },
    server: {
      port: 5173,
      strictPort: true,
      proxy: {
        "/api": {
          target: apiTarget,
          changeOrigin: true,
          // 백엔드는 X-Forwarded-Host·Proto로 다운로드 링크 주소를 만든다 (forward-headers-strategy: framework).
          // changeOrigin이 Host를 백엔드 주소로 바꾸므로, 브라우저가 연 개발 서버 주소를 따로 넘긴다.
          // compose·Ingress에서는 nginx가 같은 헤더를 보낸다.
          configure: (proxy) => {
            proxy.on("proxyReq", (proxyReq, req) => {
              const encrypted = "encrypted" in req.socket && req.socket.encrypted === true;
              const proto = encrypted ? "https" : "http";
              const host = req.headers.host;
              proxyReq.setHeader("X-Forwarded-Proto", proto);
              if (host) proxyReq.setHeader("X-Forwarded-Host", host);
              // Tomcat(native 전략)은 X-Forwarded-Host의 포트를 버리고 X-Forwarded-Port를 쓴다. 없으면 80/443으로 본다.
              proxyReq.setHeader("X-Forwarded-Port", forwardedPort(host, proto));
            });
          },
        },
      },
    },
    test: {
      environment: "jsdom",
      globals: true,
      setupFiles: ["./src/test/setup.ts"],
      css: false,
      // 실제 백엔드에 붙는 통합 테스트는 기본 실행에서 뺀다 (npm run test:integration)
      exclude: ["**/node_modules/**", "**/dist/**", "**/*.integration.test.tsx"],
    },
  };
});
