# syntax=docker/dockerfile:1
# 프론트: Vite 빌드 결과를 비루트 nginx로 서빙한다. 컨테이너 포트 8080.

FROM node:22.23.4-alpine3.24 AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

FROM nginxinc/nginx-unprivileged:1.30.6-alpine3.24 AS runtime
# 기본 설정을 프로젝트 설정으로 교체한다 (/api 프록시, SSE, 업로드 제한)
COPY --chown=101:101 nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build --chown=101:101 /app/dist /usr/share/nginx/html
USER 101
EXPOSE 8080
