#!/usr/bin/env bash
set -euo pipefail

UIDS=(6a69f224e6032a3f00de977f 6a69f224e6037a3f00de977f 6a69f224e5032a3f00de977f)
python3 /tmp/_apply-aimarkets-user-certs.py "${UIDS[@]}"

echo "=== cert chain depths ==="
for product in hermes openclaw nanoclaw; do
  h="6a69f224e6032a3f00de977f.${product}.aimarkets.vn"
  n=$(echo | openssl s_client -connect 127.0.0.1:443 -servername "$h" -showcerts 2>/dev/null \
    | grep -c "BEGIN CERTIFICATE" || true)
  subj=$(echo | openssl s_client -connect 127.0.0.1:443 -servername "$h" 2>/dev/null \
    | openssl x509 -noout -subject -issuer 2>/dev/null | tr '\n' ' ')
  echo "$h depth=$n $subj"
done

echo "=== API services ==="
docker service ls --format '{{.Name}}' | grep -iE 'aimarket|api' || true

SVC=$(docker service ls --format '{{.Name}}' | grep -i 'aimarketplace-api' | head -1 || true)
if [[ -z "$SVC" ]]; then
  SVC=$(docker service ls --format '{{.Name}}' | grep -iE 'marketplace.*api|api.*aimarket' | head -1 || true)
fi
echo "SVC=$SVC"
if [[ -n "$SVC" ]]; then
  docker service inspect "$SVC" --format '{{range .Spec.TaskTemplate.ContainerSpec.Env}}{{println .}}{{end}}' \
    | grep -iE 'NANOCLAW|HERMES_AIMARKETS_PUBLIC|OPENCLAW_AIMARKETS_PUBLIC' || echo '(no matching env)'
  # Force per-buyer NanoClaw host (same as Hermes/OpenClaw)
  docker service update \
    --env-add 'NANOCLAW_AIMARKETS_PUBLIC_URL_TEMPLATE=https://{userId}.nanoclaw.aimarkets.vn' \
    --env-rm 'NANOCLAW_PROXVN_URL_TEMPLATE' \
    "$SVC" >/dev/null
  echo "updated NANOCLAW template on $SVC"
  sleep 8
  docker service inspect "$SVC" --format '{{range .Spec.TaskTemplate.ContainerSpec.Env}}{{println .}}{{end}}' \
    | grep -i NANOCLAW || true
fi

# Probe launch-shaped URLs
echo "=== probes ==="
curl -sS -m 10 -o /dev/null -w "hermes:%{http_code}\n" -H "Host: 6a69f224e6032a3f00de977f.hermes.aimarkets.vn" https://127.0.0.1/login || true
curl -sS -m 10 -o /dev/null -w "nanoclaw_tenant:%{http_code}\n" -H "Host: 6a69f224e6032a3f00de977f.nanoclaw.aimarkets.vn" https://127.0.0.1/dashboard || true
echo DONE
