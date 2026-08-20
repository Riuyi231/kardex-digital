#!/usr/bin/env bash
set -euo pipefail

DOMAIN="${1:-}"
DUCK_TOKEN="${2:-}"
APP_DIR="/opt/nexalert-server"
DATA_DIR="/var/lib/nexalert"
PORT="3200"
SRC_DIR="$(cd "$(dirname "$0")/.." && pwd)"

if [ -z "$DOMAIN" ]; then
  echo "Uso: sudo bash deploy/setup.sh TU-SUBDOMINIO.duckdns.org DUCK_TOKEN"
  exit 1
fi

echo "==> Node.js 24"
apt-get update >/dev/null 2>&1 || true
apt-get install -y curl ca-certificates >/dev/null 2>&1 || true
NODE_MAJOR=$(node -v 2>/dev/null | sed 's/^v//;s/\..*$//' || true)
if [ -z "$NODE_MAJOR" ] || [ "$NODE_MAJOR" -lt 24 ]; then
  curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
  apt-get install -y nodejs
fi
node -v

echo "==> Caddy"
if ! command -v caddy >/dev/null 2>&1; then
  apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl >/dev/null 2>&1 || true
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list >/dev/null
  apt-get update
  apt-get install -y caddy
fi
caddy version

echo "==> Copiando codigo a $APP_DIR"
mkdir -p "$APP_DIR" "$DATA_DIR"
cp -a "$SRC_DIR/src" "$APP_DIR/"
cp -a "$SRC_DIR/app" "$APP_DIR/"
cp -f "$SRC_DIR/package.json" "$APP_DIR/"
[ -f "$SRC_DIR/package-lock.json" ] && cp -f "$SRC_DIR/package-lock.json" "$APP_DIR/"

echo "==> Dependencias"
cd "$APP_DIR"
npm install --omit=dev --no-audit --no-fund

echo "==> Apuntando DuckDNS a la IP publica"
if [ -n "$DUCK_TOKEN" ]; then
  SUBDOMAIN="${DOMAIN%%.duckdns.org}"
  curl -fsS "https://www.duckdns.org/update?domains=$SUBDOMAIN&token=$DUCK_TOKEN&ip=" || true
fi

echo "==> Usuario del sistema"
id -u nexalert >/dev/null 2>&1 || useradd --system --home "$APP_DIR" --shell /usr/sbin/nologin nexalert
chown -R nexalert:nexalert "$APP_DIR" "$DATA_DIR"

echo "==> Servicio systemd"
cat >/etc/systemd/system/nexalert.service <<UNIT
[Unit]
Description=NexAlert Server
After=network.target

[Service]
WorkingDirectory=$APP_DIR
Environment=PORT=$PORT
Environment=DATA_DIR=$DATA_DIR
ExecStart=/usr/bin/node src/index.js
Restart=always
RestartSec=3
User=nexalert

[Install]
WantedBy=multi-user.target
UNIT

echo "==> Configuracion Caddy (HTTPS)"
mkdir -p /etc/caddy
cat >/etc/caddy/Caddyfile <<CADDY
$DOMAIN {
  reverse_proxy 127.0.0.1:$PORT
}
CADDY

echo "==> Firewall local"
if command -v ufw >/dev/null 2>&1; then
  ufw allow 22/tcp >/dev/null 2>&1 || true
  ufw allow 80/tcp >/dev/null 2>&1 || true
  ufw allow 443/tcp >/dev/null 2>&1 || true
  ufw --force enable >/dev/null 2>&1 || true
fi

echo "==> Arrancando servicios"
systemctl daemon-reload
systemctl enable --now nexalert >/dev/null 2>&1 || true
systemctl enable --now caddy >/dev/null 2>&1 || true
sleep 3
systemctl restart nexalert caddy || true
sleep 3

echo "==> Estado"
systemctl --no-pager is-active nexalert
systemctl --no-pager is-active caddy
curl -fsS "http://127.0.0.1:$PORT/api/health" && echo
sleep 2
curl -fsS "https://$DOMAIN/api/health" && echo
echo "LISTO: https://$DOMAIN"
