/**
 * AI Markets buyer tickets.
 *
 * ai-marketplace-api issues `base64url({uid,exp}).HMAC` tickets when a buyer
 * launches OpenClaw (see ai-marketplace-api src/utils/openclaw-ticket.js). The
 * Control UI stores the ticket in the `aimt` cookie so the WebSocket upgrade
 * proves which buyer owns the tab. Requests touching `market-<uid>` sessions
 * are then limited to the matching buyer. The secret chain must stay
 * identical on both sides.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";

export const AIMARKETS_TICKET_COOKIE = "aimt";

const USER_ID_RE = /^[a-f0-9]{24}$/;
const MARKET_SESSION_RE = /(?:^|[:/_-])market[:_-]([a-f0-9]{24})(?![a-f0-9])/gi;
const MAX_SCAN_DEPTH = 6;
const MAX_SCAN_NODES = 2_000;

function readEnv(name: string): string {
  const value = process.env[name];
  return typeof value === "string" ? value.trim() : "";
}

export function resolveAimarketsTicketSecret(): string {
  return (
    readEnv("OPENCLAW_MARKET_TICKET_SECRET") ||
    readEnv("AIMARKETS_SERVICE_SECRET") ||
    readEnv("NEST_SERVICE_AUTH_SECRET") ||
    readEnv("PYTHON_AI_SHARED_SECRET")
  );
}

/**
 * Opt-in: enforced when the dedicated OPENCLAW_MARKET_TICKET_SECRET is set
 * (same value on ai-marketplace-api), or OPENCLAW_AIMARKETS_TICKET_ENFORCE=1.
 * Shared fallback secrets alone never enable it, so a secret mismatch between
 * services cannot lock buyers out. OPENCLAW_AIMARKETS_TICKET_ENFORCE=0 disables.
 */
export function isAimarketsTicketEnforced(): boolean {
  const flag = readEnv("OPENCLAW_AIMARKETS_TICKET_ENFORCE").toLowerCase();
  if (flag === "0" || flag === "false" || flag === "off") {
    return false;
  }
  if (flag === "1" || flag === "true" || flag === "on") {
    return Boolean(resolveAimarketsTicketSecret());
  }
  return Boolean(readEnv("OPENCLAW_MARKET_TICKET_SECRET"));
}

/**
 * Shared-secret token for AI Markets Control UI connections, derived from the
 * AI Markets secrets so buyers never receive the gateway token PHHotel uses.
 * ai-marketplace-api derives the same value (src/utils/openclaw-ticket.js).
 * Empty unless both secrets are set.
 */
export function resolveAimarketsGatewayToken(): string {
  const serviceSecret = readEnv("AIMARKETS_SERVICE_SECRET");
  const ticketSecret = readEnv("OPENCLAW_MARKET_TICKET_SECRET");
  if (!serviceSecret || !ticketSecret) {
    return "";
  }
  return createHmac("sha256", ticketSecret)
    .update(`aimarkets-openclaw-gateway:v1:${serviceSecret}`, "utf8")
    .digest("hex")
    .slice(0, 48);
}

/** True for `openclaw.aimarkets.vn` and `{userId}.openclaw.aimarkets.vn` (port ignored). */
export function isAimarketsHost(host: string | undefined): boolean {
  const suffix = (
    readEnv("OPENCLAW_AIMARKETS_HOST_SUFFIX") || "openclaw.aimarkets.vn"
  ).toLowerCase();
  const hostname = String(host ?? "")
    .trim()
    .toLowerCase()
    .replace(/:\d+$/, "");
  return hostname === suffix || hostname.endsWith(`.${suffix}`);
}

function sign(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(`aimt.v1.${payload}`, "utf8").digest("base64url");
}

/** Returns the verified buyer id, or null for missing/forged/expired tickets. */
export function verifyAimarketsTicket(ticket: string | undefined, now = Date.now()): string | null {
  const secret = resolveAimarketsTicketSecret();
  const raw = String(ticket ?? "").trim();
  if (!secret || !raw) {
    return null;
  }
  const [payload, sig, extra] = raw.split(".");
  if (!payload || !sig || extra !== undefined) {
    return null;
  }
  const a = Buffer.from(sig);
  const b = Buffer.from(sign(payload, secret));
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return null;
  }
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      uid?: unknown;
      exp?: unknown;
    };
    const uid = String(data?.uid ?? "").toLowerCase();
    if (!USER_ID_RE.test(uid)) {
      return null;
    }
    if (typeof data.exp !== "number" || !Number.isFinite(data.exp) || data.exp < now) {
      return null;
    }
    return uid;
  } catch {
    return null;
  }
}

function readCookie(header: string | string[] | undefined, name: string): string | undefined {
  const raw = Array.isArray(header) ? header.join("; ") : header;
  if (!raw) {
    return undefined;
  }
  for (const part of raw.split(";")) {
    const eq = part.indexOf("=");
    if (eq <= 0) {
      continue;
    }
    if (part.slice(0, eq).trim() !== name) {
      continue;
    }
    const value = part.slice(eq + 1).trim();
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }
  return undefined;
}

/** Verified buyer id carried by the WebSocket upgrade request, if any. */
export function resolveAimarketsUserIdFromUpgrade(
  req: Pick<IncomingMessage, "headers"> | undefined,
): string | undefined {
  if (!req) {
    return undefined;
  }
  return (
    verifyAimarketsTicket(readCookie(req.headers.cookie, AIMARKETS_TICKET_COOKIE)) ?? undefined
  );
}

/** Collects every `market-<uid>` buyer id referenced anywhere in request params. */
export function collectMarketSessionUserIds(params: unknown): Set<string> {
  const found = new Set<string>();
  let visited = 0;
  const visit = (value: unknown, depth: number) => {
    if (visited++ > MAX_SCAN_NODES || depth > MAX_SCAN_DEPTH) {
      return;
    }
    if (typeof value === "string") {
      if (!/market/i.test(value)) {
        return;
      }
      for (const match of value.matchAll(MARKET_SESSION_RE)) {
        found.add(match[1].toLowerCase());
      }
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        visit(item, depth + 1);
      }
      return;
    }
    if (value && typeof value === "object") {
      for (const item of Object.values(value as Record<string, unknown>)) {
        visit(item, depth + 1);
      }
    }
  };
  visit(params, 0);
  return found;
}

/**
 * Returns an error message when a non-internal client references a buyer
 * session it does not own, otherwise null.
 */
export function checkAimarketsSessionAccess(params: {
  requestParams: unknown;
  clientUserId: string | undefined;
}): string | null {
  const referenced = collectMarketSessionUserIds(params.requestParams);
  if (referenced.size === 0) {
    return null;
  }
  for (const uid of referenced) {
    if (uid !== params.clientUserId) {
      return params.clientUserId
        ? "This AI Markets session belongs to another account."
        : "AI Markets session requires a valid launch ticket. Open OpenClaw again from aimarkets.vn.";
    }
  }
  return null;
}
