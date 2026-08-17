# Cloud runner: Python SDK + agent-browser (Node tarball + Playwright; minimal apt).
FROM python:3.12-slim

ARG AGENT_BROWSER_VERSION=0.9.4
ARG NODE_VERSION=22.16.0
ARG GH_VERSION=2.97.0

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
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

RUN npm install -g "agent-browser@${AGENT_BROWSER_VERSION}" \
    && npx --yes playwright install-deps chromium \
    && npx --yes playwright install chromium \
    && mkdir -p /tmp/agent-browser \
    && AGENT_BROWSER_SESSION=image-warmup AGENT_BROWSER_SOCKET_DIR=/tmp/agent-browser \
       agent-browser --json open about:blank \
    && agent-browser --json close

ENV PATH="/root/.local/bin:${PATH}"

# Agent Reach — curated research backends.
# `agent-reach install --env=server` used to install mcporter/Exa, gh and the yt-dlp
# config. Upstream turned it into a read-only "safe mode" doctor check that reports
# missing dependencies without installing them, which broke the trailing guards
# (dash returns 127 from `command -v` on a missing binary). mcporter is not optional:
# research_web_search shells out to it for Exa semantic search, so a runner without
# it has no web search at all. Install the core dependencies explicitly and keep
# agent-reach itself for the optional social channels, which stay best-effort.
RUN set -eux; \
    arch="$(uname -m)"; \
    case "${arch}" in \
      x86_64) gh_arch="amd64" ;; \
      aarch64) gh_arch="arm64" ;; \
      *) echo "unsupported arch: ${arch}"; exit 1 ;; \
    esac; \
    curl -fsSL "https://github.com/cli/cli/releases/download/v${GH_VERSION}/gh_${GH_VERSION}_linux_${gh_arch}.tar.gz" \
      | tar -xz -C /tmp; \
    mv "/tmp/gh_${GH_VERSION}_linux_${gh_arch}/bin/gh" /usr/local/bin/gh; \
    rm -rf "/tmp/gh_${GH_VERSION}_linux_${gh_arch}"; \
    npm install -g mcporter; \
    pip install --no-cache-dir pipx; \
    pipx install https://github.com/Panniantong/agent-reach/archive/main.zip; \
    pipx install yt-dlp; \
    mcporter config add exa https://mcp.exa.ai/mcp --scope home; \
    mkdir -p /root/.config/yt-dlp; \
    printf '%s\n' '--js-runtimes node' >> /root/.config/yt-dlp/config; \
    (/root/.local/bin/agent-reach install --env=server --channels twitter,reddit,bilibili || true); \
    (/root/.local/bin/agent-reach doctor --json > /opt/agent-reach-boot-check.json || true); \
    command -v mcporter >/dev/null; \
    command -v agent-reach >/dev/null; \
    command -v gh >/dev/null

COPY sdk/python /app/sdk/python
RUN pip install --no-cache-dir reportlab openpyxl -e "/app/sdk/python"

CMD ["python", "-m", "qlix.cloud_runner"]
