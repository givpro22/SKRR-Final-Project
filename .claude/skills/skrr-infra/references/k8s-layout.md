# 쿠버네티스 세부 구성

이름은 다른 서비스 설정과 연결되므로 임의로 바꾸지 않는다. 네임스페이스는 `skrr`다.

## Service

| 이름 | 포트 | 호출자 |
|---|---|---|
| `frontend` | 80 | Ingress |
| `backend` | 8080 | frontend |
| `ai` | 8000 | backend |
| `runner` | 3001 | backend |
| `postgres` | 5432 | backend |

## ConfigMap과 Secret 분배

서비스에는 자기에게 필요한 값만 준다. 하나의 Secret을 모두에게 주면 실행기 격리가 무너진다.

| 리소스 | 키 | 받는 서비스 |
|---|---|---|
| ConfigMap `skrr-backend` | `STORAGE_TYPE`(base `s3`, local `local`), `AWS_REGION`, `S3_BUCKET`, `AI_SERVER_URL`, `RUNNER_URL`, `SPRING_DATASOURCE_URL`, local만 `LOCAL_STORAGE_DIR` | backend |
| Secret `skrr-backend` | `SPRING_DATASOURCE_USERNAME`, `SPRING_DATASOURCE_PASSWORD`, `TEST_CONTROL_TOKEN`, `LOCAL_STORAGE_SIGNING_KEY`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | backend |
| ConfigMap `skrr-ai` | `AWS_REGION`, `S3_BUCKET`, `LLM_PROVIDER`, `LLM_MODEL`, `EMBEDDING_MODEL`, `LLM_BASE_URL`, `KB_DATA_DIR`, local만 `DOCUMENT_SOURCE_DIR` | ai |
| Secret `skrr-ai` | `LLM_API_KEY`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | ai |
| ConfigMap `skrr-runner` | `RUNNER_ALLOWED_TARGET_HOSTS` | runner |
| Secret `skrr-postgres` | `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` | postgres |
| Secret `skrr-basic-auth` | `users` | Traefik Middleware |

S3 호환 저장소를 쓸 때만 `S3_ENDPOINT`, `S3_PATH_STYLE`을 backend·ai ConfigMap에 더한다. 튜닝값(`LLM_TIMEOUT_SECONDS`, `LLM_MAX_RETRIES`, `MAX_DOCUMENT_BYTES`, `CONNECTIVITY_TIMEOUT_MS`)은 앱 기본값을 쓰고 바꿀 때만 넣는다. 클러스터 신원 연동(EKS IRSA 등)을 쓰면 AWS 키 항목을 뺀다. 저장소에는 값 없는 `secret.example.yaml`만 둔다.

## NetworkPolicy

기본 거부 후 필요한 경로만 연다.

```text
Ingress 컨트롤러 → frontend:80
frontend → backend:8080
backend → ai:8000, runner:3001, postgres:5432, 대상 사이트, S3(443)
ai → S3(443), LLM 제공자
runner → 대상 사이트 (증거 파일은 backend가 runner:3001에서 가져간다, ADR-023)
모든 파드 → kube-dns:53
```

실행기 송신 정책의 예시는 다음과 같다. FQDN 필터가 없는 CNI에서는 IP 대역으로 제한하므로, 애플리케이션의 `RUNNER_ALLOWED_TARGET_HOSTS` 검사와 함께 이중으로 막는다.

```yaml
egress:
  - to:
      - namespaceSelector:
          matchLabels:
            kubernetes.io/metadata.name: kube-system
    ports:
      - { protocol: UDP, port: 53 }
      - { protocol: TCP, port: 53 }
  - to:
      - ipBlock:
          cidr: 0.0.0.0/0
          except: [10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, 169.254.0.0/16]
    ports:
      - { protocol: TCP, port: 443 }
```

대상 사이트가 사설망이나 HTTP에 있으면 overlay에서 해당 주소만 추가한다.

## 리소스 시작값

부하 측정 전의 추정치다. 실제 사용량을 보고 조정한다.

| 서비스 | 요청 | 제한 |
|---|---|---|
| frontend | 50m / 64Mi | 200m / 128Mi |
| backend | 250m / 512Mi | 1000m / 1Gi |
| ai | 250m / 512Mi | 1000m / 2Gi |
| runner | 500m / 1Gi | 2000m / 2Gi |
| postgres | 100m / 256Mi | 500m / 512Mi |

로컬 LLM(Ollama)을 고르면 GPU와 메모리 요구가 크게 바뀌므로 ADR-010 결정 후 다시 잡는다.

## overlay 차이

| 항목 | local | dev |
|---|---|---|
| 이미지 | `kind load`한 로컬 태그 | 레지스트리 고정 태그 (미정) |
| 접속 | port-forward 또는 kind 포트 매핑 | 도메인 + TLS (미정) |
| 대상 사이트 | 로컬 또는 배포 URL | 배포 URL |
| 스토리지 | kind 기본 StorageClass | 클러스터 StorageClass |
| 문서 저장 (ADR-021) | `STORAGE_TYPE=local` + PVC `doc-storage`(backend 쓰기, ai 읽기 전용) | S3 |
| Basic Auth | 생략 가능 | 필수 |
