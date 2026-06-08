FROM python:3.12-slim

ARG AGENT_BROWSER_VERSION=0.9.4
ARG NODE_VERSION=22.16.0

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    LUNA_BROWSER_HEADLESS=1 \
    LUNA_BROWSER_ENGINE=agent_browser \
    AGENT_BROWSER_BIN=/usr/local/bin/agent-browser \
    AGENT_BROWSER_SOCKET_DIR=/tmp/agent-browser

WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates curl xz-utils \
    && rm -rf /var/lib/apt/lists/*

RUN set -eux; \
    arch="$(uname -m)"; \
    case "${arch}" in \
      x86_64) node_arch="x64" ;; \
      aarch64) node_arch="arm64" ;; \
      *) echo "unsupported arch: ${arch}"; exit 1 ;; \
    esac; \
    curl -fsSL "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-${node_arch}.tar.xz" \
      | tar -xJ -C /usr/local --strip-components=1

RUN npm install -g "agent-browser@${AGENT_BROWSER_VERSION}" \
    && npx --yes playwright install-deps chromium \
    && npx --yes playwright install chromium \
    && mkdir -p /tmp/agent-browser \
    && AGENT_BROWSER_SESSION=image-warmup AGENT_BROWSER_SOCKET_DIR=/tmp/agent-browser \
       agent-browser --json open about:blank \
    && agent-browser --json close
COPY sdk/python /app/sdk/python
RUN pip install --no-cache-dir -e "/app/sdk/python"
COPY backend/.qlix-runners/cmq4tgn8o000j9d30k9zrgg7u/adk /app/adk
CMD ["python", "-m", "qlix.cloud_runner"]
