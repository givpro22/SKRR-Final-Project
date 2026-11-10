# syntax=docker/dockerfile:1
# 실행기: TypeScript를 빌드하고 Playwright 공식 이미지에서 비루트로 실행한다. 포트 3001.
# 이미지 태그(v1.65.0)는 package.json의 @playwright/test 버전과 같아야 브라우저가 맞는다.
# DB·AWS·LLM 자격 증명을 넣지 않는다 (ADR-005). 임시 파일은 /tmp에만 쓴다.

FROM node:22.23.4-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build && npm prune --omit=dev

FROM mcr.microsoft.com/playwright:v1.65.0-noble AS runtime
# 브라우저는 /ms-playwright 에 이미 설치되어 있으므로 다시 받지 않는다
ENV NODE_ENV=production \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 \
    TMPDIR=/tmp
RUN groupadd --system --gid 10001 runner \
 && useradd --system --uid 10001 --gid runner --create-home --home-dir /home/runner --shell /usr/sbin/nologin runner
WORKDIR /app
COPY --from=build --chown=10001:10001 /app/package.json ./package.json
COPY --from=build --chown=10001:10001 /app/node_modules ./node_modules
COPY --from=build --chown=10001:10001 /app/dist ./dist
USER 10001
EXPOSE 3001
CMD ["node", "dist/server.js"]
