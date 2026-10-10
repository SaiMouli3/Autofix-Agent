# syntax=docker/dockerfile:1.7
# ---------------------------------------------------------------- web build
FROM node:22.11-alpine3.20 AS web
WORKDIR /web
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
RUN npm run build

# ---------------------------------------------------------------- runtime
FROM python:3.12.7-slim-bookworm AS runtime
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1 \
    OPENHANDS_SUPPRESS_BANNER=1 SCA_DATA_DIR=/data SCA_STATIC_DIR=/app/frontend/dist
# tmux: required by the OpenHands terminal tool (local runtime)
# docker CLI: used to launch sandboxed agent-server containers (docker runtime)
RUN apt-get update && apt-get install -y --no-install-recommends tmux git curl ca-certificates gnupg \
 && install -m 0755 -d /etc/apt/keyrings \
 && curl -fsSL https://download.docker.com/linux/debian/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg \
 && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/debian bookworm stable" > /etc/apt/sources.list.d/docker.list \
 && apt-get update && apt-get install -y --no-install-recommends docker-ce-cli \
 && apt-get purge -y gnupg && rm -rf /var/lib/apt/lists/*
WORKDIR /app/backend
COPY backend/pyproject.toml ./
COPY backend/sca ./sca
COPY backend/alembic ./alembic
COPY backend/alembic.ini ./
RUN pip install ".[postgres]"
COPY --from=web /web/dist /app/frontend/dist
RUN useradd --create-home --uid 10001 sca && mkdir -p /data && chown sca:sca /data
USER sca
VOLUME ["/data"]
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 CMD curl -fsS http://127.0.0.1:8000/healthz || exit 1
CMD ["uvicorn", "sca.main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers", "--forwarded-allow-ips", "*"]
