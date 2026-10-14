/**
 * Browser-side gateway identity reset for the Control UI.
 *
 * Used by the "Log out" account-menu action and by the AI Markets launch flow
 * when a launch link belongs to a different buyer than the identity stored in
 * this browser. Clears everything that would make the next connect reuse the
 * previous account: gateway token/password, device identity and device tokens,
 * per-gateway session selection, AI Markets ticket/context and the `aimt` cookie.
 */
import {
  clearAimarketsTicket,
  peekAimarketsTicketUserId,
  readStoredAimarketsTicketUserId,
} from "./aimarkets-ticket.ts";
import { isAimarketsHostname } from "./audience-models.ts";

const CLEARED_KEY_PREFIXES = [
  "openclaw.control.settings.v1",
  "openclaw.control.token.v1",
  "openclaw.control.currentGateway.v1",
  "openclaw.control.user.v1",
  "openclaw.device.auth.v1",
  "openclaw-device-identity-v1",
  "openclaw.aimarkets.ticket.v1",
  "openclaw.aimarkets.context.v1",
  "openclaw.phhotel.context.v1",
] as const;

function clearStorage(storage: Storage | undefined | null): void {
  if (!storage) {
    return;
  }
  const keys: string[] = [];
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (key && CLEARED_KEY_PREFIXES.some((prefix) => key.startsWith(prefix))) {
      keys.push(key);
    }
  }
  for (const key of keys) {
    storage.removeItem(key);
  }
}

/** Removes stored gateway credentials, device identity and session state for this origin. */
export function clearGatewayBrowserState(): void {
  try {
    clearStorage(globalThis.localStorage);
  } catch {
    // storage unavailable
  }
  try {
    clearStorage(globalThis.sessionStorage);
  } catch {
    // storage unavailable
  }
  clearAimarketsTicket();
}

/** Logs out of this gateway origin and returns to the connect screen. */
export function logoutControlUi(basePath = ""): void {
  clearGatewayBrowserState();
  const base = basePath.replace(/\/+$/, "");
  globalThis.location?.replace(`${base}/`);
}

const AIMARKETS_CONTEXT_KEY = "openclaw.aimarkets.context.v1";
const USER_ID_RE = /^[a-f0-9]{24}$/;

function readStoredAimarketsUserId(): string | null {
  try {
    const raw = globalThis.localStorage?.getItem(AIMARKETS_CONTEXT_KEY);
    const parsed = raw ? (JSON.parse(raw) as { userId?: unknown }) : null;
    const userId = typeof parsed?.userId === "string" ? parsed.userId.trim().toLowerCase() : "";
    if (USER_ID_RE.test(userId)) {
      return userId;
    }
  } catch {
    // ignore
  }
  return readStoredAimarketsTicketUserId();
}

/**
 * Buyer id a launch link is for: the `marketTicket` owner when present,
 * otherwise the `userId` param. Null when the link names no buyer.
 */
export function resolveAimarketsLaunchUserId(location: {
  search?: string;
  hash?: string;
}): string | null {
  const params = new URLSearchParams(location.search ?? "");
  const rawHash = location.hash ?? "";
  const hashParams = new URLSearchParams(rawHash.startsWith("#") ? rawHash.slice(1) : rawHash);
  const fromTicket = peekAimarketsTicketUserId(
    params.get("marketTicket") ?? hashParams.get("marketTicket"),
  );
  if (fromTicket) {
    return fromTicket;
  }
  const userId = (
    params.get("userId") ??
    hashParams.get("userId") ??
    params.get("user_id") ??
    hashParams.get("user_id") ??
    ""
  )
    .trim()
    .toLowerCase();
  return USER_ID_RE.test(userId) ? userId : null;
}

/**
 * AI Markets: when the launch link belongs to another buyer than the identity
 * stored in this browser, drop the old token/device/session state before the
 * Control UI loads settings, so it reconnects with the new link's credentials
 * instead of failing with "This AI Markets session belongs to another account".
 * Returns true when state was cleared.
 */
export function resetGatewayStateOnAimarketsIdentitySwitch(
  location: { search?: string; hash?: string },
  hostname: string | undefined = globalThis.location?.hostname,
): boolean {
  if (!isAimarketsHostname(hostname)) {
    return false;
  }
  const nextUserId = resolveAimarketsLaunchUserId(location);
  if (!nextUserId) {
    return false;
  }
  const storedUserId = readStoredAimarketsUserId();
  if (!storedUserId || storedUserId === nextUserId) {
    return false;
  }
  clearGatewayBrowserState();
  return true;
}
