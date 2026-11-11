---
name: skrr-infra
description: "SKRR의 Docker 이미지와 Kubernetes 배포를 구성·수정한다. Dockerfile, Docker Compose, Kustomize 매니페스트, Traefik Ingress, Secret, ConfigMap, PVC, NetworkPolicy, 실행기 격리, kind 로컬 클러스터, nginx 프록시, GitHub Actions, 배포 문제 해결을 요청하면 반드시 이 스킬을 사용할 것. 대상 쇼핑몰 자체 구현이나 애플리케이션 로직 수정에는 쓰지 않는다."
---

# 인프라 구성

매니페스트 세부 값은 `references/k8s-layout.md`에 있다. 시작 전에 `docs/architecture.md`, `docs/decisions.md`의 ADR-004~009, `harness/context/infra-baseline.md`를 읽는다.

## 원칙

- 이미지 태그를 고정한다. `latest`를 쓰면 같은 커밋도 다르게 빌드될 수 있다.
- 비밀값은 커밋하지 않는다. 저장소가 공개 상태다. `.env.example`과 `secret.example.yaml`에는 이름만 적는다.
- 외부에는 프론트만 노출한다. 백엔드, AI, 실행기, DB는 ClusterIP다.
- 설정 값(포트, 환경변수, 제한값)은 `docs/architecture.md`와 같게 맞추고, 바꾸면 문서도 고치게 `contract-architect`에게 알린다.
- 도구와 이미지의 지원 상태는 기억으로 판단하지 않고 공식 문서로 확인한다. 예를 들어 `ingress-nginx`는 2026년 3월에 지원이 끝났다.

## 승인이 필요한 작업

다음은 실행 전에 **반드시 사용자 승인**을 받는다. 비용, 외부 공개, 되돌리기 어려움이 따르기 때문이다.

- 로컬 kind 외의 클러스터에 `kubectl apply`
- 레지스트리로 이미지 푸시
- 클라우드 리소스 생성, 삭제, 권한 변경
- 시크릿 실제 값 생성이나 표시

## 이미지

| 서비스 | 빌드 | 런타임 | 주의 |
|---|---|---|---|
| frontend | Node 22 alpine | nginx alpine, 비루트 변형 사용 | lock 파일 + `npm ci` |
| backend | Maven Wrapper + Temurin 21 | Temurin 21 JRE | 테스트는 CI에서 실행, 이미지 빌드는 `-DskipTests` |
| ai | Python 3.12 slim | 같은 이미지 | sqlite-vec 확장이 로드되는 CPU 아키텍처인지 확인 |
| runner | Playwright 공식 이미지 | 같은 이미지 | 태그가 `@playwright/test` 버전과 일치해야 브라우저가 맞음 |

공통: 멀티 스테이지, `.dockerignore`, 비루트 사용자, 의존성 파일을 먼저 복사해 빌드 캐시 활용. 맥의 ARM과 클러스터의 AMD64가 다르면 멀티 아키텍처 빌드를 고려한다.

## 프론트 nginx

```nginx
location /api/ {
    proxy_pass http://backend:8080/api/;
    client_max_body_size 21M;  # 파일 20MB + multipart 오버헤드. 파일 크기 제한은 Spring이 건다
}

location ~ ^/api/v1/runs/[^/]+/events$ {
    proxy_pass http://backend:8080;
    proxy_http_version 1.1;
    proxy_set_header Connection "";
    proxy_buffering off;
    proxy_cache off;
    proxy_read_timeout 3600s;
}

location / {
    try_files $uri /index.html;
}
```

`proxy_pass`의 호스트는 nginx 시작 시점에 해석되므로 쿠버네티스 Service 이름을 `backend`로 맞춘다. `/api/ai`처럼 AI를 직접 노출하는 경로는 만들지 않는다 (ADR-009). 버퍼링을 켠 채 두면 SSE가 몰아서 도착해 실시간 표시가 깨진다.

## 쿠버네티스 구성

```text
infra/k8s/
  base/       namespace, frontend, backend, ai, runner, postgres, kustomization.yaml
  overlays/
    local/    kind용. 이미지 kind load, 작은 리소스, 대상 호스트
    dev/      실제 클러스터용 (클러스터 결정 후 채움)
```

핵심 구성 요소는 다음과 같다.

| 서비스 | 형태 | 레플리카 | 저장소 | 이유 |
|---|---|---|---|---|
| frontend | Deployment | 2까지 가능 | 없음 | 상태 없음 |
| backend | Deployment | 1 | 없음 | SSE 구독이 메모리에 있음 (ADR-007) |
| ai | Deployment `Recreate` | 1 | RWO PVC `/data/kb` | sqlite-vec 파일 (ADR-004) |
| runner | Deployment | 1 | `emptyDir` | 동시 1건, 임시 파일 |
| postgres | StatefulSet | 1 | RWO PVC | 개발 환경용. 운영 DB는 별도 판단 |

`Recreate`로 두는 이유는 RWO 볼륨을 잡은 이전 파드가 있으면 새 파드가 시작하지 못하기 때문이다.

## 실행기 격리 (ADR-005)

LLM 출력에서 파생된 동작을 실행하는 서비스이므로 가장 엄격하게 막는다.

- `runAsNonRoot`, `allowPrivilegeEscalation: false`, 불필요한 capability 제거, 서비스 어카운트 토큰 자동 마운트 끔
- CPU, 메모리 제한 필수. `/dev/shm`은 메모리 `emptyDir`로 충분히 준다 (Chromium이 사용)
- Secret을 넘기지 않는다 (DB, AWS, LLM 키 없음)
- NetworkPolicy: 수신은 백엔드에서 3001번만. 송신은 DNS와 대상 사이트만 허용하고 클러스터 내부와 메타데이터 주소(`169.254.169.254`)는 막는다. 증거 파일은 백엔드가 3001번으로 가져가므로 S3 송신은 없다 (ADR-023)

NetworkPolicy는 이를 지원하는 CNI에서만 동작한다. 적용 후 실제로 차단되는지 파드 안에서 확인하고, 확인하지 못했다면 미검증으로 보고한다.

## 인증과 Ingress

Traefik 표준 Ingress로 `/`를 `frontend:80`에 연결하고, BasicAuth Middleware를 건다 (ADR-011). 비밀번호 파일은 Secret으로 둔다. 업로드 제한과 SSE 설정은 프론트 nginx에 있으며, Ingress를 거쳐도 스트림이 이어지는지 실제로 확인한다.

## 프로브

| 서비스 | readiness | liveness |
|---|---|---|
| backend | `/actuator/health/readiness` | `/actuator/health/liveness` |
| ai | `/internal/v1/readyz` | `/internal/v1/healthz` |
| runner | `/internal/v1/healthz` | `/internal/v1/healthz` |
| frontend | `/` | `/` |

실행기 `readyz`는 유휴 상태일 때만 통과하므로 readiness에 쓰지 않는다. 쓰면 실행 중에 Service에서 빠져 진행 조회와 중단 요청이 끊긴다. 백엔드는 시작이 느리므로 `startupProbe`를 둔다.

## 로컬 개발

Compose는 빠른 개발용이다. `compose.yaml`에 PostgreSQL과 서비스들을 정의하고 `.env`를 쓴다. 쿠버네티스 동작 확인은 kind를 쓴다.

## CI (GitHub Actions)

프로젝트 자체의 CI다. 제품 기능의 CI/CD 연동(제외 범위)과는 별개다. 변경된 영역만 테스트하고, 계약 검사와 매니페스트 검증을 넣는다. 레지스트리가 정해지기 전에는 이미지 푸시 단계를 넣지 않는다.

## 검증

```bash
docker build -t skrr/{service}:dev {service}/
kubectl kustomize infra/k8s/overlays/local | kubeconform -strict -summary -
kind create cluster --name skrr
kubectl apply -k infra/k8s/overlays/local --context kind-skrr
kubectl rollout status deployment/backend -n skrr --context kind-skrr
```

`--context kind-skrr`로 대상을 명시한다. 현재 kubectl이 다른 클러스터를 가리킬 수 있기 때문이다. 없는 도구는 임의로 설치하지 말고 설치를 제안하며, 실행하지 못한 검증은 미검증으로 보고한다. 끝날 때 프로브 통과, SSE 통과, 업로드 20MB 경계, 실행기 네트워크 차단을 확인한다.
