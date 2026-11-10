# dev overlay (미작성)

실제 클러스터용 overlay. 다음이 정해지면 `kustomization.yaml`을 만든다.

- 클러스터 종류와 StorageClass
- 이미지 레지스트리와 고정 태그 (푸시는 사용자 승인 후)
- 도메인과 TLS (Ingress host, cert)
- AWS 자격 증명 방식 (클러스터 신원 연동이면 Secret의 AWS 키 제거)
- Traefik 설치 네임스페이스 (base NetworkPolicy의 `traefik`과 다르면 패치)
- 대상 사이트 주소 (`RUNNER_ALLOWED_TARGET_HOSTS`, 사설망이면 NetworkPolicy 추가)
