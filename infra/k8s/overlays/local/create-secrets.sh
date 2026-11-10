#!/usr/bin/env bash
# kind 로컬 클러스터(kind-skrr)에 Secret을 만든다. 값은 저장소 루트의 .env에서 읽는다.
# 서비스마다 필요한 키만 담는다. 실행기(runner)에는 Secret을 만들지 않는다 (ADR-005).
#
#   infra/k8s/overlays/local/create-secrets.sh [.env 경로]
#
# 필요한 .env 항목: POSTGRES_DB, POSTGRES_USER, POSTGRES_PASSWORD, TEST_CONTROL_TOKEN,
#   LOCAL_STORAGE_SIGNING_KEY, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, LLM_API_KEY, BASIC_AUTH_USER, BASIC_AUTH_PASSWORD
# 값을 화면에 출력하지 않는다.
set -euo pipefail

CONTEXT="kind-skrr"
NAMESPACE="skrr"
ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"
ENV_FILE="${1:-$ROOT/.env}"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "환경 파일이 없습니다: $ENV_FILE (.env.example을 복사해 채우세요)" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

require() {
  local name="$1"
  if [[ -z "${!name:-}" ]]; then
    echo "$name 값이 비어 있습니다: $ENV_FILE" >&2
    exit 1
  fi
}
require POSTGRES_USER
require POSTGRES_PASSWORD
require BASIC_AUTH_USER
require BASIC_AUTH_PASSWORD

POSTGRES_DB="${POSTGRES_DB:-skrr}"
if [[ "$POSTGRES_DB" != "skrr" ]]; then
  echo "경고: POSTGRES_DB=$POSTGRES_DB. ConfigMap skrr-backend의 SPRING_DATASOURCE_URL(DB 이름 skrr)도 바꿔야 합니다." >&2
fi

KUBECTL=(kubectl --context "$CONTEXT" --namespace "$NAMESPACE")

kubectl --context "$CONTEXT" create namespace "$NAMESPACE" --dry-run=client -o yaml \
  | kubectl --context "$CONTEXT" apply -f - >/dev/null

apply_secret() {
  "${KUBECTL[@]}" create secret generic "$@" --dry-run=client -o yaml \
    | "${KUBECTL[@]}" apply -f - >/dev/null
  echo "Secret $1 적용"
}

apply_secret skrr-postgres \
  --from-literal=POSTGRES_USER="$POSTGRES_USER" \
  --from-literal=POSTGRES_PASSWORD="$POSTGRES_PASSWORD" \
  --from-literal=POSTGRES_DB="$POSTGRES_DB"

apply_secret skrr-backend \
  --from-literal=SPRING_DATASOURCE_USERNAME="$POSTGRES_USER" \
  --from-literal=SPRING_DATASOURCE_PASSWORD="$POSTGRES_PASSWORD" \
  --from-literal=TEST_CONTROL_TOKEN="${TEST_CONTROL_TOKEN:-}" \
  --from-literal=LOCAL_STORAGE_SIGNING_KEY="${LOCAL_STORAGE_SIGNING_KEY:-}" \
  --from-literal=AWS_ACCESS_KEY_ID="${AWS_ACCESS_KEY_ID:-}" \
  --from-literal=AWS_SECRET_ACCESS_KEY="${AWS_SECRET_ACCESS_KEY:-}"

apply_secret skrr-ai \
  --from-literal=LLM_API_KEY="${LLM_API_KEY:-}" \
  --from-literal=AWS_ACCESS_KEY_ID="${AWS_ACCESS_KEY_ID:-}" \
  --from-literal=AWS_SECRET_ACCESS_KEY="${AWS_SECRET_ACCESS_KEY:-}"

# Traefik BasicAuth: htpasswd 형식 (apr1)
HTPASSWD_LINE="$BASIC_AUTH_USER:$(openssl passwd -apr1 "$BASIC_AUTH_PASSWORD")"
apply_secret skrr-basic-auth --from-literal=users="$HTPASSWD_LINE"
