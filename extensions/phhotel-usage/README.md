# PHHotel Usage (OpenClaw plugin)

Reports real LLM token usage from OpenClaw gateway to PHHotel AI quota (`channel: openclaw`).

# PHHotel Usage (OpenClaw plugin)

1. **Quota gate** — `before_agent_run` gọi Nest `POST /ai-usage/internal/check`.
   - Được phép khi: gói có `packageQuota`, **hoặc** admin đã **phân bổ bonus** (`bonusQuota > 0`) dù KS chưa đăng ký gói AI (giống quyền dùng khi đã có hạn ngạch).
   - Admin/superadmin: Nest bypass unlimited.
   - Hết hạn ngạch → **không** gọi Featherless; trả lời mua thêm hạn ngạch.
2. **Usage report** — `llm_output` + `agent_end` → `POST /ai-usage/internal/openclaw` (đồng bộ trang Hạn ngạch AI trên hotelapp).

## Flow

1. Control UI mở với `session=hotel-<hotelId>__u-<userId>`
2. Mỗi tin nhắn: check quota → nếu OK mới chạy model
3. Sau khi model trả lời: báo token thật về Nest (`channel: openclaw`)

## Env (gateway)

| Variable                            | Purpose                                         |
| ----------------------------------- | ----------------------------------------------- |
| `PHHOTEL_API_URL` or `NEST_API_URL` | API base (default `https://api.phhotel.vn`)     |
| `NEST_SERVICE_AUTH_SECRET`          | Same secret as phhotel-api                      |
| `PHHOTEL_HOTEL_ID`                  | Fallback hotel id if session is not `hotel-...` |

## Enable

`openclaw.json` — **required** `hooks.allowConversationAccess`:

```json
"plugins": {
  "entries": {
    "phhotel-usage": {
      "enabled": true,
      "hooks": {
        "allowConversationAccess": true
      },
      "config": {
        "apiBaseUrl": "${PHHOTEL_API_URL}",
        "serviceSecret": "${NEST_SERVICE_AUTH_SECRET}"
      }
    }
  }
}
```

Restart OpenClaw gateway after deploy. Open Control UI via hotelapp **Mở OpenClaw**.

Logs:

- `[phhotel-usage] quota ok hotel=... remaining=...`
- `[phhotel-usage] quota exceeded ...` → không gọi Featherless
- `[phhotel-usage] reported openclaw usage ...`
