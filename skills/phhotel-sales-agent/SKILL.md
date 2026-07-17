---
name: phhotel-sales-agent
description: Handles PHHotel room quotes, SePay deposit QR, payment confirmation, and booking closure. Invoke when users ask about availability, room rates, deposits, or booking via chat, fanpage, Zalo, or Telegram.
metadata:
  openclaw:
    requires:
      env:
        - NEST_BACKEND_URL
        - NEST_API_TOKEN
        - FEATHERLESS_API_KEY
---

# PHHotel Sales Agent

Use this skill for hotel sales conversations that need live PHHotel data:

- checking vacant rooms
- checking room types and room pricing
- generating a booking-deposit QR payment
- confirming SePay transfer completion
- creating a booking after deposit confirmation
- closing sales from fanpage, Zalo OA, Telegram, or website live chat

Do not use this skill for management-only requests such as revenue, payroll, internal reports, or shift handover data unless the user explicitly asks for those operational tasks.

## Runtime Inputs

- Base API URL: `$NEST_BACKEND_URL`
- API auth: `Authorization: Bearer $NEST_API_TOKEN`
- Default public hotel API host: `https://api.phhotel.vn`
- Default public OpenClaw host: `https://openclaw.phhotel.vn`

The conversation or upstream bridge should usually provide:

- `hotelId`
- guest check-in and check-out dates
- number of guests
- number of rooms
- guest name
- guest phone

If one of the booking fields is missing, ask only for the missing fields. Do not repeat information already present in the conversation.

## Workflow

1. Resolve the target `hotelId`.
2. Check room types and room availability before promising inventory.
3. Quote the room clearly, including room type, nightly price, and booking conditions.
4. If the guest wants to hold the room, create a booking-deposit payment QR.
5. After the guest says they transferred, verify payment status from PHHotel/SePay data.
6. Only create the booking after payment status is confirmed as `completed`.
7. Return a concise guest-facing answer in Vietnamese unless the user is clearly speaking English.
8. If the conversation comes from fanpage, Zalo, or Telegram, keep the answer short enough to send back to that channel directly.

## API Playbook

Always send:

```bash
Authorization: Bearer $NEST_API_TOKEN
Accept: application/json
Content-Type: application/json
```

### 1. Room types

Use:

```bash
curl -sS "$NEST_BACKEND_URL/room-categories?hotelId=<HOTEL_ID>" \
  -H "Authorization: Bearer $NEST_API_TOKEN" \
  -H "Accept: application/json"
```

If room-category data is incomplete, use:

```bash
curl -sS "$NEST_BACKEND_URL/rooms/room-types?hotelId=<HOTEL_ID>" \
  -H "Authorization: Bearer $NEST_API_TOKEN" \
  -H "Accept: application/json"
```

### 2. Vacant rooms

Use:

```bash
curl -sS "$NEST_BACKEND_URL/rooms/available?hotelId=<HOTEL_ID>&checkInDate=<YYYY-MM-DD>&checkOutDate=<YYYY-MM-DD>" \
  -H "Authorization: Bearer $NEST_API_TOKEN" \
  -H "Accept: application/json"
```

If the user only needs a quick snapshot of current rooms, you may also use:

```bash
curl -sS "$NEST_BACKEND_URL/rooms?hotelId=<HOTEL_ID>&lite=1" \
  -H "Authorization: Bearer $NEST_API_TOKEN" \
  -H "Accept: application/json"
```

### 3. Room pricing

Use the room type id with:

```bash
curl -sS "$NEST_BACKEND_URL/priceConfig/hotel/<HOTEL_ID>/roomType/<ROOM_TYPE_ID>" \
  -H "Authorization: Bearer $NEST_API_TOKEN" \
  -H "Accept: application/json"
```

If needed, use:

```bash
curl -sS "$NEST_BACKEND_URL/priceConfig/calculate" \
  -H "Authorization: Bearer $NEST_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"hotelId":"<HOTEL_ID>","roomTypeId":"<ROOM_TYPE_ID>","checkInDate":"<YYYY-MM-DD>","checkOutDate":"<YYYY-MM-DD>","numberOfGuests":2,"numberOfRooms":1}'
```

### 4. Create booking deposit QR

Use:

```bash
curl -sS "$NEST_BACKEND_URL/sepay/create-payment-history" \
  -H "Authorization: Bearer $NEST_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "hotelId":"<HOTEL_ID>",
    "paymentType":"booking_deposit",
    "amount":<DEPOSIT_AMOUNT>,
    "currency":"VND",
    "description":"Dat coc phong",
    "guestName":"<GUEST_NAME>",
    "guestPhone":"<GUEST_PHONE>",
    "metadata":{
      "checkInDate":"<YYYY-MM-DD>",
      "checkOutDate":"<YYYY-MM-DD>",
      "numberOfGuests":<GUESTS>,
      "numberOfRooms":<ROOMS>,
      "roomTypeId":"<ROOM_TYPE_ID>"
    }
  }'
```

Return the QR/payment code and tell the guest to transfer with the exact content.

### 5. Confirm transfer completion

Check payment status with either `paymentCode` or `paymentHistoryId`:

```bash
curl -sS "$NEST_BACKEND_URL/sepay/payment-status?hotelId=<HOTEL_ID>&paymentCode=<PAYMENT_CODE>" \
  -H "Authorization: Bearer $NEST_API_TOKEN" \
  -H "Accept: application/json"
```

Do not mark the booking as paid unless the backend status is `completed`.

Note: the real booking settlement is finalized by the backend SePay webhook. Your role is to verify the status from the backend and proceed only after the backend confirms it.

### 6. Create booking

After payment confirmation, create the booking:

```bash
curl -sS "$NEST_BACKEND_URL/bookings" \
  -H "Authorization: Bearer $NEST_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "hotelId":"<HOTEL_ID>",
    "roomTypeId":"<ROOM_TYPE_ID>",
    "checkInDate":"<YYYY-MM-DD>",
    "checkOutDate":"<YYYY-MM-DD>",
    "guestName":"<GUEST_NAME>",
    "guestPhone":"<GUEST_PHONE>",
    "numberOfGuests":<GUESTS>,
    "numberOfRooms":<ROOMS>,
    "paymentStatus":"paid"
  }'
```

## Guardrails

- Never invent room availability, room type, room number, or price.
- Never skip payment verification for deposit-based booking closure.
- Never ask the same booking field twice when it is already present in the conversation.
- Prefer short guest-facing answers after the API result is known.
- Keep channel replies ready to send back to fanpage, Zalo, Telegram, or website chat without extra internal notes.
- If an API fails, explain briefly that the system cannot verify live inventory/payment right now and ask the guest to retry.
