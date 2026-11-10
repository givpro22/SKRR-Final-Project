import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";

const config = loadConfig();
const app = buildApp({ config });

if (config.allowedHosts.length === 0) {
  app.log.warn("RUNNER_ALLOWED_TARGET_HOSTS가 비어 있어 모든 대상 사이트를 거부합니다");
}

const shutdown = (signal: string): void => {
  app.log.info({ signal }, "실행기 종료");
  app.close().then(
    () => process.exit(0),
    () => process.exit(1),
  );
};
process.once("SIGTERM", () => shutdown("SIGTERM"));
process.once("SIGINT", () => shutdown("SIGINT"));

try {
  await app.listen({ host: config.host, port: config.port });
} catch (err) {
  app.log.error({ err }, "실행기를 시작하지 못했습니다");
  process.exit(1);
}
