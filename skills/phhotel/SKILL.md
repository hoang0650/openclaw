---
name: phhotel
description: PHHotel live sales ops via Nest API — room availability, pricing, SePay deposit QR, payment confirm, booking close. Use for OpenClaw Control UI / gateway automation when guests ask about rooms, rates, deposits, or booking (not for Fanpage/Zalo/Telegram owned by PHGroup-AI social bots unless explicitly bridging).
metadata:
  openclaw:
    requires:
      env:
        - NEST_BACKEND_URL
        - NEST_API_TOKEN
    optionalEnv:
      - PHHOTEL_API_URL
      - NEST_SERVICE_AUTH_SECRET
      - PHHOTEL_HOTEL_ID
---

# PHHotel Sales Agent (OpenClaw)

Use this skill when the **OpenClaw agent** must call live PHHotel Nest APIs:

- vacant rooms / room types / pricing
- SePay booking-deposit QR
- payment status check
- create booking after deposit is `completed`

Aligned with:

- `phhotel-api/backend` routes: `/rooms`, `/sepay`, `/priceConfig`, `/room-categories`
- `PHGroup-AI/chat_engine.py` tool order and payloads
- `openclaw/extensions/phhotel-usage` (quota reporting — gateway plugin, not agent curl)

## Do not use for

- Fanpage / Zalo / Telegram CSKH owned by **PHGroup-AI social controllers** (those report `channel: sales` themselves)
- Management-only work (revenue, payroll, shift handover) unless the user explicitly asks
- Claiming live inventory/payment without a Bearer JWT

## Runtime

| Item              | Value                                                                                |
| ----------------- | ------------------------------------------------------------------------------------ |
| API base          | `$PHHOTEL_API_URL` or `$NEST_BACKEND_URL` or `https://api.phhotel.vn`                |
| OpenClaw host     | `https://openclaw.phhotel.vn`                                                        |
| Hotel ops auth    | `Authorization: Bearer $NEST_API_TOKEN` (user JWT with hotel/room access)            |
| Usage plugin auth | `X-Service-Secret: $NEST_SERVICE_AUTH_SECRET` — **plugin only**, not for rooms/sepay |

Session key (from hotelapp / PHGroup-AI openclaw admin) must be:

- `hotel-<hotelId>` or
- `hotel-<hotelId>__u-<userId>`

so `phhotel-usage` can attribute OpenClaw tokens to the hotel quota.

Collect only missing fields: `hotelId`, check-in/out, guests/rooms, guest name, guest phone. Do not re-ask known facts.

## Mandatory booking order

Same as `PHGroup-AI` system prompt / tools:

1. `_fetch_available_rooms` → `GET /rooms/available`
2. `createBookingDepositPayment` → `POST /sepay/create-payment-history`
3. `checkBookingDepositPaymentStatus` → `GET /sepay/payment-status` (**must be `completed`**)
4. `createRoomBooking` → `POST /rooms/booking`

Never invent availability, room number, or price. Never create a booking before deposit is confirmed `completed`.

## API playbook

Always send:

```bash
Authorization: Bearer $NEST_API_TOKEN
Accept: application/json
Content-Type: application/json
```

Base URL examples use `https://api.phhotel.vn` — substitute `$NEST_BACKEND_URL` when set.

### 1. Room types

```bash
curl -sS "https://api.phhotel.vn/room-categories?hotelId=<HOTEL_ID>" \
  -H "Authorization: Bearer $NEST_API_TOKEN" -H "Accept: application/json"
```

Fallback:

```bash
curl -sS "https://api.phhotel.vn/rooms/room-types?hotelId=<HOTEL_ID>" \
  -H "Authorization: Bearer $NEST_API_TOKEN" -H "Accept: application/json"
```

### 2. Vacant rooms

```bash
curl -sS "https://api.phhotel.vn/rooms/available?hotelId=<HOTEL_ID>&checkInDate=<YYYY-MM-DD>&checkOutDate=<YYYY-MM-DD>" \
  -H "Authorization: Bearer $NEST_API_TOKEN" -H "Accept: application/json"
```

Quick snapshot (not date-aware):

```bash
curl -sS "https://api.phhotel.vn/rooms?hotelId=<HOTEL_ID>&lite=1" \
  -H "Authorization: Bearer $NEST_API_TOKEN" -H "Accept: application/json"
```

### 3. Pricing

By room type:

```bash
curl -sS "https://api.phhotel.vn/priceConfig/hotel/<HOTEL_ID>/roomType/<ROOM_TYPE_ID>" \
  -H "Authorization: Bearer $NEST_API_TOKEN" -H "Accept: application/json"
```

Calculate for a **specific room** (body must use `roomId` + `rateType`, not guest counts):

```bash
curl -sS "https://api.phhotel.vn/priceConfig/calculate" \
  -H "Authorization: Bearer $NEST_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "roomId":"<ROOM_ID>",
    "checkInDate":"<YYYY-MM-DD>",
    "checkOutDate":"<YYYY-MM-DD>",
    "rateType":"daily"
  }'
```

`rateType`: `hourly` | `daily` | `nightly`.

### 4. Create booking-deposit QR (`booking_deposit`)

Requires Nest **user** ObjectId (`userId` = authenticated hotel/staff account from the JWT, **not** the guest phone), plus **`roomId`** and **`amount`**.

```bash
curl -sS "https://api.phhotel.vn/sepay/create-payment-history" \
  -H "Authorization: Bearer $NEST_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "userId":"<NEST_USER_OBJECT_ID>",
    "hotelId":"<HOTEL_ID>",
    "roomId":"<ROOM_ID>",
    "roomNumber":"<ROOM_NUMBER>",
    "amount":<DEPOSIT_AMOUNT>,
    "currency":"VND",
    "description":"Coc giu phong",
    "paymentType":"booking_deposit",
    "paymentCodePrefix":"BOT",
    "guestName":"<GUEST_NAME>",
    "guestPhone":"<GUEST_PHONE>",
    "checkInDate":"<YYYY-MM-DD>",
    "checkOutDate":"<YYYY-MM-DD>",
    "rateType":"daily"
  }'
```

Return QR / transfer content exactly. Settlement is finalized by SePay webhook; only proceed after status check.

### 5. Confirm deposit

```bash
curl -sS "https://api.phhotel.vn/sepay/payment-status?hotelId=<HOTEL_ID>&paymentCode=<PAYMENT_CODE>&paymentType=booking_deposit" \
  -H "Authorization: Bearer $NEST_API_TOKEN" -H "Accept: application/json"
```

Optional: `paymentHistoryId`, `roomId`. Proceed only when `completed === true` or `status === "completed"`.

### 6. Create booking

Use **`POST /rooms/booking`** (not `POST /bookings`). Deposit must already be completed; chat_engine requires `advancePayment > 0` and `advancePaymentMethod: "bank_transfer"`.

```bash
curl -sS "https://api.phhotel.vn/rooms/booking" \
  -H "Authorization: Bearer $NEST_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "hotelId":"<HOTEL_ID>",
    "roomId":"<ROOM_ID>",
    "guestInfo":{
      "name":"<GUEST_NAME>",
      "phone":"<GUEST_PHONE>",
      "email":"",
      "idNumber":"",
      "guestSource":"direct"
    },
    "checkInDate":"<YYYY-MM-DD>",
    "checkOutDate":"<YYYY-MM-DD>",
    "rateType":"daily",
    "advancePayment":<DEPOSIT_AMOUNT>,
    "advancePaymentMethod":"bank_transfer",
    "notes":""
  }'
```

## AI usage / quota (context)

| Channel    | Who records                       | Endpoint                                                |
| ---------- | --------------------------------- | ------------------------------------------------------- |
| `openclaw` | Plugin `phhotel-usage` on gateway | `POST /ai-usage/internal/openclaw` + `X-Service-Secret` |
| `sales`    | PHGroup-AI Zalo/FB/Telegram       | `POST /ai-usage/internal/record`                        |
| `chatbox`  | hotelapp Nest assistant           | user JWT `/ai-usage/record` or Nest after `/chat`       |

Agents using this skill do **not** call usage endpoints. Ensure session is `hotel-<id>…` and gateway env has `NEST_SERVICE_AUTH_SECRET` + `PHHOTEL_API_URL`.

Default Featherless model in PHGroup-AI: `deepseek-ai/DeepSeek-V4-Flash` (fallbacks Qwen / MiniMax). OpenClaw Control UI models are configured on the gateway separately.

## Reply style

- Vietnamese by default; English only if the guest writes English
- Short, channel-ready answers (no internal notes)
- One missing question at a time
- On API failure: say live verification is unavailable and ask to retry — do not invent data

## Guardrails

- Never invent rooms, prices, or payment success
- Never skip deposit verification
- Never use fictional `POST /bookings` bodies (`roomTypeId` / `guestName` / `paymentStatus: "paid"`)
- Never call `create-payment-history` without `userId` + `amount` (+ `roomId` for deposits)
- Never call `priceConfig/calculate` with `roomTypeId` / guest counts — use `roomId` + `rateType`
- Service secret alone cannot create bookings; hotel APIs need Bearer JWT
