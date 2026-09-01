# Cloud runner: Python SDK + agent-browser (Node tarball + Playwright; minimal apt).
FROM python:3.12-slim

ARG AGENT_BROWSER_VERSION=0.9.4
ARG NODE_VERSION=22.16.0

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    HOME=/home/qlix \
    XDG_CACHE_HOME=/home/qlix/.cache \
    XDG_CONFIG_HOME=/home/qlix/.config \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
    LUNA_BROWSER_HEADLESS=1 \
    LUNA_BROWSER_ENGINE=agent_browser \
    QLIX_BROWSER_LIVE_VIEW=1 \
    AGENT_BROWSER_BIN=/usr/local/bin/agent-browser \
    AGENT_BROWSER_SOCKET_DIR=/tmp/agent-browser

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates curl xz-utils \
    && rm -rf /var/lib/apt/lists/*

# Official Node.js binary (avoid Debian nodejs/npm meta-package and mirror 400s).
RUN set -eux; \
    arch="$(uname -m)"; \
    case "${arch}" in \
      x86_64) node_arch="x64" ;; \
      aarch64) node_arch="arm64" ;; \
      *) echo "unsupported arch: ${arch}"; exit 1 ;; \
    esac; \
    curl -fsSL "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-${node_arch}.tar.xz" \
      | tar -xJ -C /usr/local --strip-components=1

RUN mkdir -p /home/qlix /ms-playwright \
    && npm install -g "agent-browser@${AGENT_BROWSER_VERSION}" \
    && npx --yes playwright install-deps chromium \
    && npx --yes playwright install chromium \
    && mkdir -p /tmp/agent-browser \
    && AGENT_BROWSER_SESSION=image-warmup AGENT_BROWSER_SOCKET_DIR=/tmp/agent-browser \
       agent-browser --json open about:blank \
    && agent-browser --json close

ENV PIPX_HOME=/opt/pipx \
    PIPX_BIN_DIR=/usr/local/bin

# Agent Reach — curated research backends.
# Core install (--env=server, no --channels) sets up mcporter/Exa, gh, and yt-dlp
# config. Optional social channels are best-effort so a flaky upstream installer
# can't break the image — unavailable sources degrade gracefully at runtime.
RUN pip install --no-cache-dir pipx \
    && pipx install https://github.com/Panniantong/agent-reach/archive/main.zip \
    && agent-reach install --env=server \
    && pipx install yt-dlp \
    && npm install -g mcporter \
    && (agent-reach install --env=server --channels twitter,reddit,bilibili || true) \
    && (agent-reach doctor --json > /opt/agent-reach-boot-check.json || true) \
    && command -v agent-reach >/dev/null \
    && command -v mcporter >/dev/null

COPY sdk/python /app/sdk/python
RUN pip install --no-cache-dir reportlab openpyxl -e "/app/sdk/python"

# The runner handles untrusted model output. It never needs host or container root.
# Runtime writes are restricted by Docker to tmpfs mounts at /tmp and /home/qlix.
RUN groupadd --gid 10001 qlix \
    && useradd --uid 10001 --gid 10001 --create-home --home-dir /home/qlix --shell /usr/sbin/nologin qlix \
    && chown -R 10001:10001 /home/qlix /tmp /ms-playwright

USER 10001:10001

CMD ["python", "-m", "qlix.cloud_runner"]
