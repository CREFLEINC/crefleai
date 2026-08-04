# syntax=docker/dockerfile:1
ARG CUDA_VERSION=13.0.1

FROM node:22 AS web-build
WORKDIR /src/web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

FROM nvidia/cuda:${CUDA_VERSION}-devel-ubuntu24.04 AS server-build
RUN apt-get update \
    && apt-get install -y --no-install-recommends cmake build-essential git ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /usr/local/bin/
ENV UV_PYTHON_INSTALL_DIR=/opt/python \
    UV_PROJECT_ENVIRONMENT=/opt/venv
WORKDIR /app/server
COPY server/pyproject.toml server/uv.lock ./
RUN uv sync --frozen --no-install-project --no-dev
COPY server/ ./
RUN uv sync --frozen --no-dev
# llama-cpp-python은 Blackwell(sm_120) 대상 CUDA 빌드 — 수십 분 소요
RUN CMAKE_ARGS="-DGGML_CUDA=on -DCMAKE_CUDA_ARCHITECTURES=120" \
    uv pip install --python /opt/venv/bin/python --no-cache-dir "llama-cpp-python>=0.3"

FROM nvidia/cuda:${CUDA_VERSION}-runtime-ubuntu24.04 AS runtime
# llama.cpp(ggml)가 OpenMP를 사용 — runtime 베이스에는 libgomp1이 없다
RUN apt-get update \
    && apt-get install -y --no-install-recommends libgomp1 \
    && rm -rf /var/lib/apt/lists/*
COPY --from=server-build /opt/python /opt/python
COPY --from=server-build /opt/venv /opt/venv
COPY --from=server-build /app/server /app/server
COPY --from=web-build /src/web/dist /app/web/dist
ENV PATH="/opt/venv/bin:${PATH}" \
    CREFLEAI_WEB_DIST=/app/web/dist \
    CREFLEAI_DATA_DIR=/app/data
WORKDIR /app/server
EXPOSE 8000
CMD ["crefleai"]
