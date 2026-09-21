#!/usr/bin/env python3
"""Write Traefik exact-Host LE routers for Aimarkets buyers (denglish pattern).

Same as ai.aimarkets.vn:
  Host(`fqdn`) + web/websecure + certResolver: letsencrypt + domains.main

Usage on VPS:
  python3 _apply-aimarkets-user-certs.py [userId ...]
Default userId: 6a69f224e6037a3f00de977f
"""
from __future__ import annotations

import sys
from pathlib import Path

DYNAMIC = Path("/etc/dokploy/traefik/dynamic")
OUT = DYNAMIC / "aimarkets-user-certs.yml"
DEFAULT_UIDS = ["6a69f224e6037a3f00de977f"]

PRODUCTS = (
    ("hermes", "hermes-aimarkets-svc"),
    ("nanoclaw", "nanoclaw-aimarkets-svc"),
    ("openclaw", "openclaw-aimarkets-svc"),
)


def routers_for(uid: str) -> str:
    blocks: list[str] = []
    for product, service in PRODUCTS:
        host = f"{uid}.{product}.aimarkets.vn"
        key = f"{product}-user-{uid}"
        blocks.append(
            f"""    {key}-http:
      rule: "Host(`{host}`)"
      entryPoints: [web]
      middlewares: [redirect-to-https]
      service: {service}
      priority: 300
    {key}-https:
      rule: "Host(`{host}`)"
      entryPoints: [websecure]
      service: {service}
      priority: 300
      tls:
        certResolver: letsencrypt
        domains:
          - main: "{host}"
"""
        )
    return "\n".join(blocks)


def main() -> None:
    uids = [u.strip().lower() for u in (sys.argv[1:] or DEFAULT_UIDS) if u.strip()]
    for uid in uids:
        if len(uid) != 24 or any(c not in "0123456789abcdef" for c in uid):
            raise SystemExit(f"invalid userId (need 24 hex): {uid}")

    body = "# Exact buyer hosts — LE HTTP-01 like Host(`ai.aimarkets.vn`) / denglish\n"
    body += "http:\n  routers:\n"
    for uid in uids:
        body += routers_for(uid)

    OUT.write_text(body, encoding="utf-8")
    print(f"wrote {OUT} for {len(uids)} user(s): {', '.join(uids)}")


if __name__ == "__main__":
    main()
