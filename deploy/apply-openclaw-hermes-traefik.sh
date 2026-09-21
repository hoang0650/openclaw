#!/usr/bin/env bash
# Chạy trên VPS (root):
#   bash apply-openclaw-hermes-traefik.sh
#
# Cập nhật:
#   /etc/dokploy/traefik/dynamic/openclaw-wildcard.yml   (PHHotel + Aimarkets)
#   /etc/dokploy/traefik/dynamic/hermes-aimarkets-wildcard.yml

set -euo pipefail

DYNAMIC="${DOKPLOY_TRAEFIK_DYNAMIC:-/etc/dokploy/traefik/dynamic}"
OPENCLAW_UPSTREAM="${OPENCLAW_UPSTREAM:-http://phhotel-openclaw-cexp1q:8080}"

HERMES_NAME="$(docker ps --format '{{.Names}}' 2>/dev/null | grep -i hermes | head -n1 || true)"
HERMES_UPSTREAM="${HERMES_UPSTREAM:-http://${HERMES_NAME:-aimarketplace-hermes-nxdss5}:9119}"

mkdir -p "$DYNAMIC"
if [[ -f "$DYNAMIC/openclaw-wildcard.yml" ]]; then
  cp -a "$DYNAMIC/openclaw-wildcard.yml" "$DYNAMIC/openclaw-wildcard.yml.bak.$(date +%s)"
fi

cat > "$DYNAMIC/openclaw-wildcard.yml" <<'YAML'
# Managed by apply-openclaw-hermes-traefik.sh — PHHotel + AI Markets OpenClaw
http:
  routers:
    openclaw-tenant-https:
      rule: "HostRegexp(`^[a-f0-9]{24}\\.phhotel\\.vn$`)"
      entryPoints:
        - websecure
      service: openclaw-svc
      tls:
        certResolver: letsencrypt
      priority: 50

    openclaw-exact-https:
      rule: "Host(`69d73f54e5302e4f720b66af.phhotel.vn`)"
      entryPoints:
        - websecure
      service: openclaw-svc
      tls:
        certResolver: letsencrypt
        domains:
          - main: "69d73f54e5302e4f720b66af.phhotel.vn"
      priority: 200

    openclaw-shared-https:
      rule: "Host(`openclaw.phhotel.vn`)"
      entryPoints:
        - websecure
      service: openclaw-svc
      tls:
        certResolver: letsencrypt
        domains:
          - main: "openclaw.phhotel.vn"
      priority: 200

    openclaw-aimarkets-tenant-https:
      rule: "HostRegexp(`^[a-f0-9]{24}\\.openclaw\\.aimarkets\\.vn$`)"
      entryPoints:
        - websecure
      service: openclaw-aimarkets-svc
      tls:
        certResolver: letsencrypt
      priority: 50

    openclaw-aimarkets-shared-https:
      rule: "Host(`openclaw.aimarkets.vn`)"
      entryPoints:
        - websecure
      service: openclaw-aimarkets-svc
      tls:
        certResolver: letsencrypt
        domains:
          - main: "openclaw.aimarkets.vn"
      priority: 200

  services:
    openclaw-svc:
      loadBalancer:
        servers:
          - url: "__OPENCLAW_UPSTREAM__"
        passHostHeader: true

    openclaw-aimarkets-svc:
      loadBalancer:
        servers:
          - url: "__OPENCLAW_UPSTREAM__"
        passHostHeader: true
YAML

cat > "$DYNAMIC/hermes-aimarkets-wildcard.yml" <<'YAML'
# Managed by apply-openclaw-hermes-traefik.sh — Hermes AI Markets
http:
  routers:
    hermes-aimarkets-tenant-https:
      rule: "HostRegexp(`^[a-f0-9]{24}\\.hermes\\.aimarkets\\.vn$`)"
      entryPoints:
        - websecure
      service: hermes-aimarkets-svc
      tls:
        certResolver: letsencrypt
      priority: 50

    hermes-aimarkets-shared-https:
      rule: "Host(`hermes.aimarkets.vn`)"
      entryPoints:
        - websecure
      service: hermes-aimarkets-svc
      tls:
        certResolver: letsencrypt
        domains:
          - main: "hermes.aimarkets.vn"
      priority: 200

  services:
    hermes-aimarkets-svc:
      loadBalancer:
        servers:
          - url: "__HERMES_UPSTREAM__"
        passHostHeader: true
YAML

# Inject upstream URLs (avoid $ expansion in regex)
python3 - "$DYNAMIC/openclaw-wildcard.yml" "$OPENCLAW_UPSTREAM" <<'PY'
import sys
path, url = sys.argv[1], sys.argv[2]
text = open(path, encoding="utf-8").read().replace("__OPENCLAW_UPSTREAM__", url)
open(path, "w", encoding="utf-8").write(text)
PY

python3 - "$DYNAMIC/hermes-aimarkets-wildcard.yml" "$HERMES_UPSTREAM" <<'PY'
import sys
path, url = sys.argv[1], sys.argv[2]
text = open(path, encoding="utf-8").read().replace("__HERMES_UPSTREAM__", url)
open(path, "w", encoding="utf-8").write(text)
PY

echo "Wrote:"
echo "  $DYNAMIC/openclaw-wildcard.yml"
echo "    upstream: $OPENCLAW_UPSTREAM"
echo "  $DYNAMIC/hermes-aimarkets-wildcard.yml"
echo "    upstream: $HERMES_UPSTREAM"
echo
echo "Containers:"
docker ps --format '{{.Names}}\t{{.Status}}' | grep -iE 'openclaw|hermes' || echo "(none)"
echo
echo "Done — Traefik should auto-reload (file watch: true)."
