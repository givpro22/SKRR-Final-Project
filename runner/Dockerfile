# syntax=docker/dockerfile:1
# 실행기: TypeScript를 빌드하고 Playwright 공식 이미지에서 비루트로 실행한다. 포트 3001.
# 이미지 태그(v1.65.0)는 package.json의 @playwright/test 버전과 같아야 브라우저가 맞는다.
# DB·AWS·LLM 자격 증명을 넣지 않는다 (ADR-005). 임시 파일은 /tmp에만 쓴다.
# 실행마다 /tmp/skrr-run-*/work 에서 `node node_modules/@playwright/test/cli.js test`를 자식 프로세스로 띄운다.
# work/node_modules 는 /app/node_modules 를 가리키는 심볼릭 링크라 /app 은 읽기만 하면 된다.

# 아키텍처별 tini 스테이지 선택용 (BuildKit이 채운다)
ARG TARGETARCH

FROM node:22.23.4-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
# dist/runtime/skrr-runtime.ts(spec과 함께 Playwright가 직접 불러오는 소스)도 빌드가 만든다
RUN npm run build && npm prune --omit=dev

# PID 1 init. Chromium·Playwright 자식이 남긴 좀비 프로세스를 거두고 신호를 전달한다.
# 정적 바이너리를 버전과 체크섬으로 고정한다 (krallin/tini v0.19.0)
FROM scratch AS tini-amd64
ADD --checksum=sha256:c5b0666b4cb676901f90dfcb37106783c5fe2077b04590973b885950611b30ee \
    https://github.com/krallin/tini/releases/download/v0.19.0/tini-static-amd64 /tini
FROM scratch AS tini-arm64
ADD --checksum=sha256:eae1d3aa50c48fb23b8cbdf4e369d0910dfc538566bfd09df89a774aa84a48b9 \
    https://github.com/krallin/tini/releases/download/v0.19.0/tini-static-arm64 /tini
FROM tini-${TARGETARCH} AS tini

FROM mcr.microsoft.com/playwright:v1.65.0-noble AS runtime
# 브라우저는 /ms-playwright 에 이미 설치되어 있으므로 다시 받지 않는다
ENV NODE_ENV=production \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 \
    TMPDIR=/tmp
RUN groupadd --system --gid 10001 runner \
 && useradd --system --uid 10001 --gid runner --create-home --home-dir /home/runner --shell /usr/sbin/nologin runner
COPY --from=tini --chmod=0755 /tini /usr/bin/tini
WORKDIR /app
# 코드와 의존성은 root 소유로 둔다. 실행기 사용자(10001)는 읽기만 하고 고칠 수 없다
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
USER 10001
EXPOSE 3001
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "dist/server.js"]
