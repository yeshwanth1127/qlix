#!/usr/bin/env bash
# =============================================================================
# Qlix — production deploy script
# Run as root (or via sudo) on the app server.
#
# Usage:
#   1. Set YOUR_DOMAIN below (or export QLIX_DOMAIN=your.subdomain.com first)
#   2. sudo bash deploy.sh
# =============================================================================
set -euo pipefail

DOMAIN="${QLIX_DOMAIN:-qlix.exora.solutions}"
APP_DIR="/var/www/qlix"
LOG_DIR="/var/log/pm2"

# ── Preflight ─────────────────────────────────────────────────────────────────
if [[ "$DOMAIN" == "YOUR_DOMAIN" ]]; then
  echo "ERROR: Set QLIX_DOMAIN before running, e.g.:"
  echo "  export QLIX_DOMAIN=qlix.example.com && sudo bash deploy.sh"
  exit 1
fi

if [[ ! -f "$APP_DIR/backend/.env" ]]; then
  echo "ERROR: $APP_DIR/backend/.env not found."
  echo "Copy .env.production.example → backend/.env and fill in all values first."
  exit 1
fi

if [[ ! -f "$APP_DIR/frontend/.env" ]]; then
  echo "ERROR: $APP_DIR/frontend/.env not found."
  echo "Copy .env.production.example → frontend/.env (keep only NEXT_PUBLIC_* vars)."
  exit 1
fi

echo "==> Domain: $DOMAIN"
echo "==> App dir: $APP_DIR"

# ── Log directory ─────────────────────────────────────────────────────────────
mkdir -p "$LOG_DIR"

# ── Install dependencies ──────────────────────────────────────────────────────
echo "==> Installing backend dependencies..."
cd "$APP_DIR/backend"
npm ci

echo "==> Installing frontend dependencies..."
cd "$APP_DIR/frontend"
npm ci

echo "==> Installing WhatsApp service dependencies (optional)..."
cd "$APP_DIR/qlix-whatsapp-service"
npm ci --omit=dev || true

echo "==> Installing Qlix MCP service dependencies..."
cd "$APP_DIR/qlix-mcp-service"
npm ci --omit=dev
npx playwright install chromium --with-deps 2>/dev/null || npx playwright install chromium || true

# ── Build ─────────────────────────────────────────────────────────────────────
echo "==> Generating Prisma client..."
cd "$APP_DIR/backend"
npx prisma generate

echo "==> Building backend (TypeScript → JS)..."
npm run build

echo "==> Building frontend (Next.js)..."
cd "$APP_DIR/frontend"
npm run build

# ── Database migrations ───────────────────────────────────────────────────────
echo "==> Running database migrations..."
cd "$APP_DIR/backend"
npx prisma migrate deploy

# ── Nginx config ─────────────────────────────────────────────────────────────
NGINX_CONF="$APP_DIR/nginx/qlix.conf"
NGINX_SITE="/etc/nginx/sites-available/qlix"
NGINX_ENABLED="/etc/nginx/sites-enabled/qlix"

echo "==> Installing nginx config for $DOMAIN..."
# Substitute placeholder with actual domain
sed "s/YOUR_DOMAIN/$DOMAIN/g" "$NGINX_CONF" > "$NGINX_SITE"

if [[ ! -L "$NGINX_ENABLED" ]]; then
  ln -sf "$NGINX_SITE" "$NGINX_ENABLED"
fi

# ── SSL certificate ───────────────────────────────────────────────────────────
CERT_PATH="/etc/letsencrypt/live/$DOMAIN/fullchain.pem"
if [[ ! -f "$CERT_PATH" ]]; then
  echo "==> Obtaining Let's Encrypt certificate for $DOMAIN..."
  # Use webroot for the acme challenge (nginx serves /.well-known/acme-challenge/)
  mkdir -p /var/www/certbot
  # Temporarily serve HTTP only to get the cert
  cat > "$NGINX_SITE" <<HTTPONLY
server {
    listen 80;
    server_name $DOMAIN;
    location /.well-known/acme-challenge/ { root /var/www/certbot; }
    location / { return 444; }
}
HTTPONLY
  nginx -t && systemctl reload nginx

  certbot certonly --webroot -w /var/www/certbot \
    -d "$DOMAIN" \
    --non-interactive --agree-tos --email "admin@$DOMAIN"

  # Now write the real HTTPS config
  sed "s/YOUR_DOMAIN/$DOMAIN/g" "$NGINX_CONF" > "$NGINX_SITE"
else
  echo "==> Certificate already exists for $DOMAIN, skipping certbot."
fi

# ── Validate and reload nginx ─────────────────────────────────────────────────
echo "==> Testing nginx config..."
nginx -t
systemctl reload nginx
echo "==> nginx reloaded."

# ── Sidecar service secrets ───────────────────────────────────────────────────
echo "==> Syncing sidecar SERVICE_SECRET from backend..."
BACKEND_ENV="$APP_DIR/backend/.env"
if [[ -f "$BACKEND_ENV" ]]; then
  SERVICE_SECRET="$(grep -E '^QLIX_INTERNAL_SERVICE_SECRET=' "$BACKEND_ENV" | cut -d= -f2- || true)"
  if [[ -n "$SERVICE_SECRET" ]]; then
    for svc in qlix-mcp-service qlix-whatsapp-service; do
      SVC_ENV="$APP_DIR/$svc/.env"
      if [[ -f "$SVC_ENV" ]]; then
        if grep -q '^SERVICE_SECRET=' "$SVC_ENV"; then
          sed -i "s|^SERVICE_SECRET=.*|SERVICE_SECRET=$SERVICE_SECRET|" "$SVC_ENV"
        else
          echo "SERVICE_SECRET=$SERVICE_SECRET" >> "$SVC_ENV"
        fi
        echo "    synced $svc/.env"
      fi
    done
  else
    echo "    WARN: QLIX_INTERNAL_SERVICE_SECRET missing in backend/.env"
  fi
fi

# ── PM2 ───────────────────────────────────────────────────────────────────────
echo "==> Starting/reloading PM2 processes..."
cd "$APP_DIR"
pm2 startOrReload ecosystem.config.cjs --env production

# Persist process list so PM2 survives reboots
pm2 save

# Register PM2 startup hook (only needed once; safe to re-run)
pm2 startup systemd -u root --hp /root | tail -1 | bash || true

echo ""
echo "================================================================"
echo " Qlix is live at https://$DOMAIN"
echo ""
echo " Useful commands:"
echo "   pm2 list                    — process status"
echo "   pm2 logs qlix-backend       — backend logs"
echo "   pm2 logs qlix-frontend      — frontend logs"
echo "   pm2 restart qlix-backend    — restart backend"
echo "   pm2 logs qlix-mcp           — MCP server logs"
echo "   pm2 restart qlix-mcp        — restart MCP server"
echo "   pm2 reload ecosystem.config.cjs  — zero-downtime reload"
echo "================================================================"
