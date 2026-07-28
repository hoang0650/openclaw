# PHHotel Usage (OpenClaw plugin)

Reports real LLM token usage from OpenClaw gateway to PHHotel AI quota (`channel: openclaw`).

## Flow

1. Control UI opens with `session=hotel-<hotelId>__u-<userId>`
2. Plugin hooks `llm_output` + `agent_end`
3. POST `https://api.phhotel.vn/ai-usage/internal/openclaw` with `X-Service-Secret`

## Env (gateway)

| Variable                            | Purpose                                         |
| ----------------------------------- | ----------------------------------------------- |
| `PHHOTEL_API_URL` or `NEST_API_URL` | API base (default `https://api.phhotel.vn`)     |
| `NEST_SERVICE_AUTH_SECRET`          | Same secret as phhotel-api                      |
| `PHHOTEL_HOTEL_ID`                  | Fallback hotel id if session is not `hotel-...` |

## Enable

`openclaw.json`:

```json
"plugins": {
  "entries": {
    "phhotel-usage": {
      "enabled": true,
      "config": {
        "apiBaseUrl": "${PHHOTEL_API_URL}",
        "serviceSecret": "${NEST_SERVICE_AUTH_SECRET}"
      }
    }
  }
}
```

Restart OpenClaw gateway after deploy. Then chat in Control UI and refresh AI Usage — OpenClaw channel should update.
