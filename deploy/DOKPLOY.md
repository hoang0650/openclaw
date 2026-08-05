# Dokploy — OpenClaw PHHotel

## Runtime (bắt buộc port 8080)

Command / Docker CMD override:

```bash
node openclaw.mjs gateway --bind lan --port 8080
```

Env:

```bash
OPENCLAW_GATEWAY_PORT=8080
OPENCLAW_GATEWAY_BIND=lan
OPENCLAW_STATE_DIR=/data/.openclaw
OPENCLAW_CONFIG_DIR=/app
OPENCLAW_CONFIG_PATH=/app/openclaw.json
OPENCLAW_WORKSPACE_DIR=/data/.openclaw/workspace
```

| Chỗ trên Dokploy         | Giá trị                             |
| ------------------------ | ----------------------------------- |
| Domains → Container Port | **8080**                            |
| Traefik upstream `url`   | `http://<service-name>:8080`        |
| Volume mount             | Host/volume → container **`/data`** |

## Lỗi `EACCES: permission denied, mkdir '/data/.openclaw/state'`

Image chạy user **`node` (uid 1000)**. Volume `/data` trên Dokploy thường thuộc **root** → không tạo được thư mục.

### Cách 1 — Sửa quyền volume (khuyên dùng, giữ persistence)

SSH vào VPS:

```bash
# Tìm container openclaw
docker ps -a --format '{{.ID}} {{.Names}}' | grep -i openclaw

# Nếu container còn tồn tại (kể cả exited):
docker run --rm -v <tên-volume-hoặc-bind-path>:/data alpine chown -R 1000:1000 /data
```

Hoặc nếu biết mount path trên host (ví dụ Dokploy volume):

```bash
sudo chown -R 1000:1000 /var/lib/docker/volumes/<volume-name>/_data
# hoặc path bind mount bạn đã cấu hình
sudo chown -R 1000:1000 /path/to/openclaw-data
```

Rồi **Redeploy / Restart** app.

Kiểm tra trong container:

```bash
docker exec -u node <container> mkdir -p /data/.openclaw/state && echo OK
```

### Cách 2 — Không dùng `/data` (nhanh, dễ mất data nếu không mount)

Đổi env (và mount volume vào đúng path này nếu cần lưu lâu dài):

```bash
OPENCLAW_STATE_DIR=/home/node/.openclaw
OPENCLAW_WORKSPACE_DIR=/home/node/.openclaw/workspace
```

Thư mục này trong image đã thuộc `node:node`. Restart app.

### Cách 3 — Mount + chown một lần bằng sidecar

Dokploy → Advanced → Mounts: mount volume vào `/data`.  
Chạy một lần job/container alpine với cùng volume: `chown -R 1000:1000 /data`.

## Wildcard `{hotelId}.phhotel.vn`

1. DNS: `A` / `*` → IP VPS
2. Dán `dokploy-traefik.yml` → Traefik File System → `traefik.yml`
3. Dán `dokploy-dynamic-middlewares.yml` → `dynamic/middlewares.yml`
4. Dán `dokploy-dynamic-openclaw-wildcard.yml` → `dynamic/openclaw-wildcard.yml` (sửa tên service, port **8080**)
5. Reload Traefik

UI Domains **không** nhận `*.phhotel.vn`. Domain cụ thể thì thêm được với port **8080**.

**Quan trọng:** `HostRegexp` chỉ được khớp `^[a-f0-9]{24}\\.phhotel\\.vn$` (hotel ObjectId).  
Regex kiểu `^[a-z0-9]+` sẽ nuốt luôn `ai` / `api` / `app` → hotelapp gọi `ai.phhotel.vn` bị CORS / `0 Unknown Error`.
