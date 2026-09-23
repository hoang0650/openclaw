#!/usr/bin/env bash
set -euo pipefail
python3 /tmp/_apply-aimarkets-user-certs.py \
  6a69f224e5032a3f00de977f \
  6a69f224e6037a3f00de977f \
  6a69f224e6032a3f00de977f
sleep 5
for h in \
  6a69f224e5032a3f00de977f.openclaw.aimarkets.vn \
  6a69f224e6037a3f00de977f.openclaw.aimarkets.vn
do
  echo "-- $h"
  echo | openssl s_client -connect 127.0.0.1:443 -servername "$h" 2>/dev/null \
    | openssl x509 -noout -subject -issuer -dates
done
TR=$(docker ps --format '{{.Names}}' | grep -i traefik | head -1)
echo "TRAEFIK=$TR"
docker logs "$TR" --since 30m 2>&1 | grep -iE 'e5032a3f.openclaw|Unable to obtain|acme' | tail -20 || true
echo DONE
