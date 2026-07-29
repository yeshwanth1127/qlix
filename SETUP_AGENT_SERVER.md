# Qlix — Agent Server & Infrastructure Setup

This document covers everything needed to run Qlix in production:

- **App server** (this machine) — runs the backend API + frontend via PM2 + Nginx
- **Agent server** (other machine, behind VPN) — runs Docker + PostgreSQL; backend provisions agent containers on it remotely

---

## Architecture Overview

```
Browser / Mobile
       │  HTTPS
       ▼
  qlix.exora.solutions  (this server — Nginx)
  ├── /          → Next.js frontend  :3000
  └── /api/      → Express backend   :4000
                         │
              ┌──────────┴──────────────┐
              │ SSH over VPN            │ TCP over VPN
              ▼                         ▼
       Docker daemon              PostgreSQL :5432
       (agent server)             (agent server)
              │
   ┌──────────┴──────────┐
   │  qlix-cloud-runner  │  (spawned per agent run)
   │  containers         │
   └─────────────────────┘
```

---

## Part 1 — Agent Server Setup (the other machine)

This is the server behind the VPN. It needs **Docker** and **PostgreSQL**.

### 1.1 — Install Docker

```bash
# Ubuntu / Debian
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER   # let your user run docker without sudo
newgrp docker                    # apply group change in current session

# Verify
docker version
```

### 1.2 — PostgreSQL

If Postgres is not already running on this server:

```bash
sudo apt install -y postgresql postgresql-contrib
sudo systemctl enable --now postgresql
```

Create the Qlix database and user:

```bash
sudo -u postgres psql <<'SQL'
CREATE USER qlix WITH PASSWORD 'STRONG_PASSWORD_HERE';
CREATE DATABASE qlix OWNER qlix;
GRANT ALL PRIVILEGES ON DATABASE qlix TO qlix;
SQL
```

Allow the **app server** to connect over the VPN. Edit `postgresql.conf`:

```bash
sudo nano /etc/postgresql/*/main/postgresql.conf
# Set:
listen_addresses = 'localhost,VPN_IP_OF_AGENT_SERVER'
```

Edit `pg_hba.conf`:

```bash
sudo nano /etc/postgresql/*/main/pg_hba.conf
# Add this line (replace with the VPN IP of the APP server):
host    qlix    qlix    APP_SERVER_VPN_IP/32    scram-sha-256
```

Restart Postgres:

```bash
sudo systemctl restart postgresql
```

### 1.3 — Build the Qlix cloud-runner image

The cloud-runner image must exist on the agent server **before** any agent is launched.
Build it once; rebuild whenever the `sdk/python` source changes.

```bash
# On the AGENT server — clone or copy the repo, then:
cd /opt/qlix   # or wherever you put it

docker build \
  -t qlix-cloud-runner:latest \
  -f sdk/python/docker/cloud-runner/Dockerfile \
  .

# Verify
docker image inspect qlix-cloud-runner:latest
```

> The Dockerfile copies `sdk/python` into the image, installs the Qlix Python SDK,
> Node.js, and Playwright/Chromium for browser-capable agents.

### 1.4 — SSH access for the app server

The backend on the app server connects to Docker **over SSH** — no TCP port needs to
be opened. Only SSH port 22 (or a custom port) needs to be reachable over the VPN.

On the **app server** (this machine), generate a deploy key if one doesn't exist:

```bash
ssh-keygen -t ed25519 -C "qlix-app-to-agent" -f /root/.ssh/qlix_agent_server -N ""
cat /root/.ssh/qlix_agent_server.pub
```

On the **agent server**, add that public key:

```bash
# As the user whose Docker socket the backend will use (e.g. ubuntu, or a dedicated 'qlix' user)
mkdir -p ~/.ssh && chmod 700 ~/.ssh
echo "PASTE_PUBLIC_KEY_HERE" >> ~/.ssh/authorized_keys
chmod 600 ~/.ssh/authorized_keys

# That user must be in the docker group
sudo usermod -aG docker $USER
```

Test the connection from the **app server**:

```bash
ssh -i /root/.ssh/qlix_agent_server ubuntu@AGENT_SERVER_VPN_IP docker version
```

You should see Docker version output. If that works, the backend will work.

### 1.5 — SSH config on app server (convenience + KeepAlive)

Add this to `/root/.ssh/config` on the **app server**:

```
Host qlix-agent
    HostName     AGENT_SERVER_VPN_IP
    User         ubuntu
    IdentityFile /root/.ssh/qlix_agent_server
    ServerAliveInterval 30
    ServerAliveCountMax 3
    StrictHostKeyChecking no
```

This lets you use `ssh qlix-agent` instead of the full `ssh -i ... user@ip`, and
also lets `DOCKER_HOST=ssh://qlix-agent` (hostname alias) work.

---

## Part 2 — App Server Configuration

### 2.1 — Install Docker CLI (no daemon needed)

The app server only needs the **Docker client** to issue commands over SSH.
It does **not** need to run a Docker daemon.

```bash
# Ubuntu — install just the CLI
sudo apt-get update
sudo apt-get install -y docker-ce-cli

# Or via the full get-docker.com script (daemon will be installed too but won't start)
curl -fsSL https://get.docker.com | sh
sudo systemctl disable --now docker   # don't run the daemon locally
```

Verify:

```bash
DOCKER_HOST=ssh://qlix-agent docker version
# Should print the remote server's Docker version
```

### 2.2 — backend/.env keys for remote Docker

In `/var/www/qlix/backend/.env`, set:

```env
# SSH alias from /root/.ssh/config  — OR use full form: ssh://ubuntu@VPN_IP
DOCKER_HOST=ssh://qlix-agent

# Image that must already exist on the agent server
QLIX_CLOUD_RUNNER_IMAGE=qlix-cloud-runner:latest

# Where per-agent Dockerfiles / state are kept on this (app) server
QLIX_CLOUD_RUNNER_STATE_DIR=/var/www/qlix/backend/.qlix-runners

# Database on the agent server
DATABASE_URL=postgresql://qlix:STRONG_PASSWORD_HERE@AGENT_SERVER_VPN_IP:5432/qlix?schema=public
```

### 2.3 — Verify end-to-end

```bash
# From the app server as root:
export DOCKER_HOST=ssh://qlix-agent
docker version          # ← should show remote Docker
docker images | grep qlix-cloud-runner   # ← should show the image

# Then check DB reachability:
psql postgresql://qlix:PASSWORD@AGENT_SERVER_VPN_IP:5432/qlix -c "SELECT 1;"
```

---

## Part 3 — Full Env Variable Reference

### backend/.env

```env
NODE_ENV=production
PORT=4000
PUBLIC_API_URL=https://qlix.exora.solutions

# External Postgres (agent server via VPN)
DATABASE_URL=postgresql://qlix:PASSWORD@AGENT_SERVER_VPN_IP:5432/qlix?schema=public

# Secrets — generate all with:
#   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
JWT_SECRET=<64 hex chars>
QLIX_PLATFORM_PRIVATE_KEY=<64 hex chars>
AGENT_SECRETS_KEY=<64 hex chars>

QLIX_PLATFORM_DID=did:qlix:platform

# CORS + cookies
FRONTEND_URL=https://qlix.exora.solutions
SESSION_COOKIE_SECURE=true

# WebAuthn
WEBAUTHN_RP_NAME=Qlix
WEBAUTHN_RP_ID=qlix.exora.solutions
WEBAUTHN_ORIGIN=https://qlix.exora.solutions

# Remote Docker (agent server via VPN SSH)
DOCKER_HOST=ssh://qlix-agent
QLIX_CLOUD_RUNNER_IMAGE=qlix-cloud-runner:latest
QLIX_CLOUD_RUNNER_STATE_DIR=/var/www/qlix/backend/.qlix-runners

# LLM proxy
OPENROUTER_API_KEY=sk-or-v1-...

# Optional — Google OAuth for Gmail connector
# GOOGLE_OAUTH_CLIENT_ID=
# GOOGLE_OAUTH_CLIENT_SECRET=
# GOOGLE_OAUTH_REDIRECT_URI=https://qlix.exora.solutions/api/v1/connectors/google/callback

# Optional — WhatsApp sidecar
# QLIX_WHATSAPP_ENABLED=1
# QLIX_WHATSAPP_SERVICE_URL=http://localhost:3939
# QLIX_INTERNAL_SERVICE_SECRET=<shared secret>

# Optional — first super-admin account
# SUPER_ADMIN_BOOTSTRAP_PASSWORD=<min 12 chars>
```

### frontend/.env

```env
NEXT_PUBLIC_API_BASE_URL=https://qlix.exora.solutions
```

---

## Part 4 — Deploying / Updating

### First deploy

```bash
# 1. Fill in both .env files (see above)
# 2. Make sure qlix-agent SSH alias resolves correctly
export QLIX_DOMAIN=qlix.exora.solutions
sudo bash /var/www/qlix/deploy.sh
```

### Updating the app

```bash
cd /var/www/qlix
git pull
sudo bash deploy.sh
# deploy.sh runs npm ci, npm run build, prisma migrate deploy, then pm2 reload
```

### Updating the cloud-runner image

When `sdk/python` changes, rebuild **on the agent server**:

```bash
# On the agent server:
cd /opt/qlix && git pull
docker build -t qlix-cloud-runner:latest -f sdk/python/docker/cloud-runner/Dockerfile .
```

No restart needed on the app server — the backend pulls the image tag at run time.

---

## Part 5 — Useful Commands

```bash
# App server — process status
pm2 list
pm2 logs qlix-backend --lines 100
pm2 logs qlix-frontend --lines 100

# App server — restart
pm2 restart qlix-backend
pm2 restart qlix-frontend

# Remote Docker (via VPN SSH)
DOCKER_HOST=ssh://qlix-agent docker ps
DOCKER_HOST=ssh://qlix-agent docker logs <container-name>
DOCKER_HOST=ssh://qlix-agent docker images | grep qlix

# Clean up stopped agent containers on the agent server
DOCKER_HOST=ssh://qlix-agent docker container prune -f

# Check SSL cert expiry
certbot certificates

# Renew certs (auto-renewed by certbot timer, but manual test):
sudo certbot renew --dry-run
```

---

## Troubleshooting

| Symptom | Check |
|---|---|
| `docker: command not found` on app server | Install `docker-ce-cli` (see 2.1) |
| `SSH connection refused` | VPN active? Correct IP in `/root/.ssh/config`? |
| `Permission denied (docker socket)` on agent server | User not in `docker` group — run `sudo usermod -aG docker USERNAME` and re-login |
| `ECONNREFUSED 5432` | PostgreSQL not listening on VPN interface — check `listen_addresses` and `pg_hba.conf` |
| `qlix-cloud-runner:latest not found` | Image not built on agent server — run the `docker build` command in 1.3 |
| Agent runs start but immediately fail | Check `pm2 logs qlix-backend` and `DOCKER_HOST=ssh://qlix-agent docker logs <container>` |
| 502 Bad Gateway | Backend/frontend not running — `pm2 list` and `pm2 restart` |
