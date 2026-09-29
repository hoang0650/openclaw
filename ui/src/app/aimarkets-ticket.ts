/**
 * AI Markets buyer ticket handling for the Control UI.
 *
 * ai-marketplace-api appends `#marketTicket=<ticket>` to the launch URL. The
 * ticket proves which buyer owns this tab: the UI keeps it in localStorage,
 * mirrors it into the `aimt` cookie so the gateway WebSocket upgrade can
 * verify it, and sends it as `X-Market-Ticket` to the marketplace key vault.
 */
import { normalizeOptionalString } from "../lib/string-coerce.ts";

const TICKET_STORAGE_KEY = "openclaw.aimarkets.ticket.v1";
const TICKET_COOKIE = "aimt";
const USER_ID_RE = /^[a-f0-9]{24}$/;

export type AimarketsTicket = { ticket: string; userId: string; expiresAt: number };

function decodeTicket(ticket: string): { userId: string; expiresAt: number } | null {
  const [payload, sig, extra] = ticket.split(".");
  if (!payload || !sig || extra !== undefined) {
    return null;
  }
  try {
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
    const data = JSON.parse(globalThis.atob(padded)) as { uid?: unknown; exp?: unknown };
    const userId = String(data?.uid ?? "").toLowerCase();
    const expiresAt = typeof data?.exp === "number" ? data.exp : Number.NaN;
    if (!USER_ID_RE.test(userId) || !Number.isFinite(expiresAt)) {
      return null;
    }
    return { userId, expiresAt };
  } catch {
    return null;
  }
}

function writeCookie(ticket: string | null, expiresAt?: number) {
  if (typeof document === "undefined") {
    return;
  }
  const secure = globalThis.location?.protocol === "https:" ? "; Secure" : "";
  if (!ticket) {
    document.cookie = `${TICKET_COOKIE}=; Path=/; Max-Age=0; SameSite=Strict${secure}`;
    return;
  }
  const maxAge = Math.max(0, Math.floor(((expiresAt ?? Date.now()) - Date.now()) / 1000));
  document.cookie = `${TICKET_COOKIE}=${encodeURIComponent(ticket)}; Path=/; Max-Age=${maxAge}; SameSite=Strict${secure}`;
}

/** Stores a freshly issued ticket. Returns false for malformed or expired tickets. */
export function storeAimarketsTicket(rawTicket: string | null | undefined): boolean {
  const ticket = normalizeOptionalString(rawTicket);
  if (!ticket) {
    return false;
  }
  const decoded = decodeTicket(ticket);
  if (!decoded || decoded.expiresAt <= Date.now()) {
    return false;
  }
  try {
    globalThis.localStorage?.setItem(
      TICKET_STORAGE_KEY,
      JSON.stringify({ ticket, userId: decoded.userId, expiresAt: decoded.expiresAt }),
    );
  } catch {
    // Storage may be unavailable (private mode); the cookie still carries the ticket.
  }
  writeCookie(ticket, decoded.expiresAt);
  return true;
}

/** Returns the stored ticket when it is still valid (and belongs to userId, if given). */
export function readAimarketsTicket(userId?: string | null): AimarketsTicket | null {
  try {
    const raw = globalThis.localStorage?.getItem(TICKET_STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as Partial<AimarketsTicket>) : null;
    const ticket = normalizeOptionalString(parsed?.ticket);
    if (!ticket) {
      return null;
    }
    const decoded = decodeTicket(ticket);
    if (!decoded || decoded.expiresAt <= Date.now()) {
      globalThis.localStorage?.removeItem(TICKET_STORAGE_KEY);
      writeCookie(null);
      return null;
    }
    const expectedUser = normalizeOptionalString(userId)?.toLowerCase();
    if (expectedUser && expectedUser !== decoded.userId) {
      return null;
    }
    return { ticket, ...decoded };
  } catch {
    return null;
  }
}

/** Re-mirrors a stored ticket into the cookie (e.g. after the cookie jar was cleared). */
export function syncAimarketsTicketCookie(userId?: string | null) {
  const stored = readAimarketsTicket(userId);
  if (stored) {
    writeCookie(stored.ticket, stored.expiresAt);
  }
}
