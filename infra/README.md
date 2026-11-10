# 인프라

결정 근거는 `docs/decisions.md`(ADR-004, 005, 008, 009, 011), 포트·환경변수·제한값의 기준은 `docs/architecture.md`다.

## 구성

| 서비스 | 이미지 (빌드 → 런타임) | 컨테이너 포트 | k8s Service | 프로브 (readiness / liveness) |
|---|---|---|---|---|
| frontend | node:22.23.4-alpine3.24 → nginxinc/nginx-unprivileged:1.30.6-alpine3.24 | 8080 | `frontend:80` | `/` / `/` |
| backend | eclipse-temurin:21.0.13_9-jdk-noble → 21.0.13_9-jre-noble | 8080 | `backend:8080` | `/actuator/health/readiness` / `/actuator/health/liveness` (+ startup) |
| ai | python:3.12.16-slim-trixie | 8000 | `ai:8000` | `/internal/v1/readyz` / `/internal/v1/healthz` |
| runner | node:22.23.4-bookworm-slim → mcr.microsoft.com/playwright:v1.65.0-noble | 3001 | `runner:3001` | `/internal/v1/healthz` / `/internal/v1/healthz` |
| postgres | postgres:16.15-alpine3.24 | 5432 | `postgres:5432` | `pg_isready` |

- 모든 앱 컨테이너는 비루트(frontend 101, 나머지 10001, postgres 70)로 실행하고 루트 파일시스템을 읽기 전용으로 둔다.
- 외부 노출은 Traefik Ingress → `frontend`뿐이다. 나머지는 ClusterIP.
- runner 이미지 태그는 `runner/package.json`의 `@playwright/test` 버전과 같아야 한다. 하나를 바꾸면 둘 다 바꾼다.

## Docker Compose (로컬 개발)

```bash
cp .env.example .env        # 값 채우기. .env는 커밋하지 않는다
docker compose up --build   # 화면 http://localhost:3000
```

호스트 포트는 127.0.0.1에만 연다: frontend 3000, backend 8080, ai 8000, runner 3001, postgres 5432.
Vite 개발 서버(`npm run dev`, 5173)는 `/api`를 `http://localhost:8080`으로 넘긴다.

문서 저장은 기본이 `STORAGE_TYPE=local`이다. backend가 `doc-storage` 볼륨(`/data/documents`)에 쓰고 ai가 같은 볼륨을 `DOCUMENT_SOURCE_DIR`로 읽는다. AWS가 필요 없다.
실제 S3를 쓰려면 `.env`에서 `STORAGE_TYPE=s3`, `DOCUMENT_SOURCE_DIR=`(비움), `S3_BUCKET`과 AWS 값을 채운다. S3 에뮬레이터는 쓰지 않는다.

## kind (쿠버네티스 로컬 검증)

`--context kind-skrr`로 대상을 항상 명시한다. 현재 kubectl이 다른 클러스터를 가리킬 수 있다.

```bash
# 1. 클러스터 (Traefik NodePort 30080 → 127.0.0.1:8088)
kind create cluster --name skrr --config infra/k8s/kind/cluster.yaml

# 2. Traefik
helm repo add traefik https://traefik.github.io/charts
helm install traefik traefik/traefik --version 42.3.1 \
  --namespace traefik --create-namespace \
  --values infra/k8s/kind/traefik-values.yaml --kube-context kind-skrr

# 3. 이미지 빌드와 적재 (클러스터 노드와 같은 아키텍처로 빌드된다)
for s in frontend backend ai runner; do
  docker build -t skrr/$s:dev $s/
  kind load docker-image skrr/$s:dev --name skrr
done

# 4. Secret (.env에서 읽음. 실행기 Secret은 없다)
infra/k8s/overlays/local/create-secrets.sh

# 5. 적용과 확인
kubectl apply -k infra/k8s/overlays/local --context kind-skrr
kubectl rollout status deployment/backend -n skrr --context kind-skrr
open http://127.0.0.1:8088   # Basic Auth
```

### 끝날 때 확인할 것

| 항목 | 방법 |
|---|---|
| 프로브 | `kubectl get pods -n skrr --context kind-skrr`에서 모두 Ready |
| SSE | `curl -N -u USER:PASS http://127.0.0.1:8088/api/v1/runs/{runId}/events`가 이벤트를 하나씩 받는지 (몰아서 오면 버퍼링) |
| 업로드 경계 | 20MB 파일은 통과, 20MB 초과는 백엔드가 거부, 21MB 초과 본문은 nginx 413 |
| 실행기 차단 | runner 파드에서 `node -e "fetch('http://backend:8080').then(()=>console.log('열림'),e=>console.log('막힘'))"`, 같은 방식으로 `http://postgres:5432`, `http://169.254.169.254` 가 막히는지 |
| Basic Auth | 인증 없이 `curl -i http://127.0.0.1:8088/` → 401 |

NetworkPolicy는 CNI가 지원해야 동작한다. kind 기본 CNI(kindnet)의 지원 여부는 사용하는 kind 버전 문서로 확인하고, 위 차단 확인을 반드시 실행한다.

## 비밀값

이 저장소는 공개 상태다. 값은 `.env`(git 제외)나 클러스터 Secret에만 둔다.
Secret 이름과 키는 `infra/k8s/base/secret.example.yaml`에 있다. 서비스마다 필요한 키만 받으며, runner는 Secret을 받지 않는다.

## overlay

- `overlays/local`: kind. 로컬 이미지 태그 `dev`, 문서 저장은 `STORAGE_TYPE=local` + PVC `doc-storage`(backend 쓰기, ai 읽기 전용, 단일 노드 전용), 호스트 머신의 대상 사이트로 가는 송신 허용(`networkpolicy-local-target.yaml`, 주소는 환경에 맞게 확인).
- base는 `STORAGE_TYPE=s3`다. 실제 클러스터는 S3를 쓴다.
- `overlays/dev`: 실제 클러스터용. 클러스터 종류, 레지스트리, 도메인, TLS가 정해지면 만든다.
