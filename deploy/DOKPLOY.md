# Dokploy — OpenClaw PHHotel

## Runtime (bắt buộc port 8080)

Command / Docker CMD override:

```bash
node openclaw.mjs gateway --bind lan --port 8080
```

Env gợi ý:

```bash
OPENCLAW_GATEWAY_PORT=8080
OPENCLAW_GATEWAY_BIND=lan
```

| Chỗ trên Dokploy         | Giá trị                      |
| ------------------------ | ---------------------------- |
| Domains → Container Port | **8080**                     |
| Traefik upstream `url`   | `http://<service-name>:8080` |

## Wildcard `{hotelId}.phhotel.vn`

1. DNS: `A` / `*` → IP VPS
2. Dán `dokploy-traefik.yml` → Traefik File System → `traefik.yml`
3. Dán `dokploy-dynamic-middlewares.yml` → `dynamic/middlewares.yml`
4. Dán `dokploy-dynamic-openclaw-wildcard.yml` → `dynamic/openclaw-wildcard.yml` (sửa tên service)
5. Reload Traefik

UI Domains **không** nhận `*.phhotel.vn`. Domain cụ thể thì thêm được với port **8080**.
