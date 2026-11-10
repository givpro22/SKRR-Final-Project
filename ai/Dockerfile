# syntax=docker/dockerfile:1
# AI 서버: FastAPI + uvicorn, 포트 8000. 의존성은 빌드 단계의 가상환경에 설치해 런타임으로 복사한다.
# sqlite-vec 확장은 CPU 아키텍처별 휠이 다르므로 클러스터 노드 아키텍처로 빌드한다 (--platform).

FROM python:3.12.16-slim-trixie AS build
ENV PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1
RUN python -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"
WORKDIR /src
COPY requirements.txt ./
RUN pip install -r requirements.txt

FROM python:3.12.16-slim-trixie AS runtime
RUN groupadd --system --gid 10001 app \
 && useradd --system --uid 10001 --gid app --no-create-home --shell /usr/sbin/nologin app \
 && mkdir -p /data/kb /data/documents \
 && chown 10001:10001 /data/kb /data/documents
ENV PATH="/opt/venv/bin:$PATH" \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    KB_DATA_DIR=/data/kb
COPY --from=build /opt/venv /opt/venv
WORKDIR /app
COPY --chown=10001:10001 app ./app
USER 10001
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
