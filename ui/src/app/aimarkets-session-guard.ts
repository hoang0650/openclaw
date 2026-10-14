/**
 * AI Markets: keep the Control UI on the current buyer's own session.
 *
 * One gateway serves every buyer. A session key such as `market-<userId>` is
 * owned by that buyer, and the gateway rejects cross-account access with
 * "This AI Markets session belongs to another account." A stale route
 * (`/chat/main/~key/market-<otherUser>`), `?session=` param or persisted
 * session selection from a previous buyer must therefore be dropped on the
 * client and replaced by `market-<currentUserId>`. The server check stays the
 * actual security boundary; this only avoids leaving the buyer stuck.
 */
import { readAimarketsTicket } from "./aimarkets-ticket.ts";
import { isAimarketsHostname } from "./audience-models.ts";
import { resolveAimarketsLaunchUserId } from "./gateway-logout.ts";

const USER_ID_RE = /^[a-f0-9]{24}$/;
const MARKET_OWNER_RE = /(?:^|[:/_-])market[:_-]([a-f0-9]{24})(?![a-f0-9])/i;
const SUBDOMAIN_RE = /^([a-f0-9]{24})\.openclaw\.aimarkets\.vn$/i;
const SETTINGS_KEY_PREFIX = "openclaw.control.settings.v1";
const AIMARKETS_CONTEXT_KEY = "openclaw.aimarkets.context.v1";
const RECOVERY_FLAG = "openclaw.aimarkets.sessionRecovery.v1";
const RECOVERY_COOLDOWN_MS = 30_000;
const KEY_SEGMENT_RE = /\/~key\/([^/?#]+)/;
export const FOREIGN_SESSION_MESSAGE = "This AI Markets session belongs to another account.";

type Loc = { pathname?: string; search?: string; hash?: string };

/** Buyer id that owns a `market-<userId>` session key, or null for other keys. */
export function marketSessionOwner(sessionKey: string | null | undefined): string | null {
  const m = MARKET_OWNER_RE.exec(String(sessionKey ?? ""));
  return m ? m[1].toLowerCase() : null;
}

/** True when the key is a market session owned by someone other than userId. */
export function isForeignMarketSession(
  sessionKey: string | null | undefined,
  userId: string,
): boolean {
  const owner = marketSessionOwner(sessionKey);
  return Boolean(owner) && owner !== userId;
}

/**
 * Current buyer: the `{userId}.openclaw.aimarkets.vn` subdomain wins, then the
 * launch link (ticket/userId param), then the stored ticket. Null off AI Markets.
 */
export function resolveAimarketsCurrentUserId(
  hostname: string | undefined = globalThis.location?.hostname,
  location: Loc = {},
): string | null {
  if (!isAimarketsHostname(hostname)) {
    return null;
  }
  const host = String(hostname ?? "")
    .toLowerCase()
    .replace(/:\d+$/, "");
  const fromHost = SUBDOMAIN_RE.exec(host)?.[1]?.toLowerCase();
  if (fromHost) {
    return fromHost;
  }
  const fromLink = resolveAimarketsLaunchUserId(location);
  if (fromLink) {
    return fromLink;
  }
  const stored = readAimarketsTicket()?.userId ?? null;
  return stored && USER_ID_RE.test(stored) ? stored : null;
}

function rewriteSessionParam(raw: string, prefix: "?" | "#", userId: string): string {
  const body = raw.startsWith(prefix) ? raw.slice(1) : raw;
  if (!body) {
    return raw;
  }
  const params = new URLSearchParams(body);
  const session = params.get("session");
  if (!session || !isForeignMarketSession(session, userId)) {
    return raw;
  }
  params.set("session", `market-${userId}`);
  return `${prefix}${params.toString()}`;
}

/**
 * Returns a corrected location when the route or `session` param points at
 * another buyer's market session, otherwise null.
 */
export function correctForeignSessionLocation<T extends Loc>(
  location: T,
  userId: string,
): T | null {
  let pathname = location.pathname ?? "";
  const m = KEY_SEGMENT_RE.exec(pathname);
  if (m) {
    let key = m[1];
    try {
      key = decodeURIComponent(m[1]);
    } catch {
      // keep raw
    }
    if (isForeignMarketSession(key, userId)) {
      pathname = pathname.replace(
        KEY_SEGMENT_RE,
        `/~key/${encodeURIComponent(`market-${userId}`)}`,
      );
    }
  }
  const search = rewriteSessionParam(location.search ?? "", "?", userId);
  const hash = rewriteSessionParam(location.hash ?? "", "#", userId);
  if (
    pathname === (location.pathname ?? "") &&
    search === (location.search ?? "") &&
    hash === (location.hash ?? "")
  ) {
    return null;
  }
  return { ...location, pathname, search, hash };
}

/** Replaces persisted session selections that belong to another buyer. Returns true if anything changed. */
export function scrubForeignPersistedSessions(userId: string, storage?: Storage | null): boolean {
  const store = storage ?? safeLocalStorage();
  if (!store) {
    return false;
  }
  let changed = false;
  const keys: string[] = [];
  for (let i = 0; i < store.length; i++) {
    const key = store.key(i);
    if (key && key.startsWith(SETTINGS_KEY_PREFIX)) {
      keys.push(key);
    }
  }
  for (const key of keys) {
    try {
      const parsed = JSON.parse(store.getItem(key) ?? "null") as Record<string, unknown> | null;
      if (!parsed || typeof parsed !== "object") {
        continue;
      }
      let dirty = false;
      for (const field of ["sessionKey", "lastActiveSessionKey"]) {
        if (
          typeof parsed[field] === "string" &&
          isForeignMarketSession(parsed[field] as string, userId)
        ) {
          parsed[field] = `market-${userId}`;
          dirty = true;
        }
      }
      if (dirty) {
        store.setItem(key, JSON.stringify(parsed));
        changed = true;
      }
    } catch {
      // ignore unparsable entries
    }
  }
  try {
    const ctx = JSON.parse(store.getItem(AIMARKETS_CONTEXT_KEY) ?? "null") as {
      userId?: unknown;
    } | null;
    if (ctx && typeof ctx.userId === "string" && ctx.userId.toLowerCase() !== userId) {
      store.setItem(AIMARKETS_CONTEXT_KEY, JSON.stringify({ userId }));
      changed = true;
    }
  } catch {
    // ignore
  }
  return changed;
}

function safeLocalStorage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/**
 * Startup guard (before settings load): on AI Markets hosts, drop a route,
 * `session` param or persisted selection that names another buyer's session.
 * Returns the corrected location, or null when nothing in the URL changed.
 */
export function guardAimarketsSessionOnStartup<T extends Loc>(
  location: T,
  hostname: string | undefined = globalThis.location?.hostname,
): T | null {
  const userId = resolveAimarketsCurrentUserId(hostname, location);
  if (!userId) {
    return null;
  }
  scrubForeignPersistedSessions(userId);
  return correctForeignSessionLocation(location, userId);
}

export function isForeignAimarketsSessionError(message: string | null | undefined): boolean {
  return String(message ?? "").includes(FOREIGN_SESSION_MESSAGE);
}

/**
 * Runtime recovery: the gateway refused a request because the selected session
 * belongs to another buyer. Clear the stale selection and reload on the
 * current buyer's own session. Rate-limited so it can never loop.
 */
export function recoverFromForeignAimarketsSession(
  win: Pick<Window, "location"> | undefined = globalThis.window,
  now = Date.now(),
): boolean {
  const loc = win?.location;
  if (!loc) {
    return false;
  }
  const userId = resolveAimarketsCurrentUserId(loc.hostname, loc);
  if (!userId) {
    return false;
  }
  try {
    const last = Number(globalThis.sessionStorage?.getItem(RECOVERY_FLAG) ?? 0);
    if (Number.isFinite(last) && now - last < RECOVERY_COOLDOWN_MS) {
      return false;
    }
    globalThis.sessionStorage?.setItem(RECOVERY_FLAG, String(now));
  } catch {
    // no sessionStorage: still recover once
  }
  scrubForeignPersistedSessions(userId);
  const own = encodeURIComponent(`market-${userId}`);
  const corrected = correctForeignSessionLocation(
    { pathname: loc.pathname, search: loc.search, hash: loc.hash },
    userId,
  );
  const target = corrected
    ? `${corrected.pathname}${corrected.search}${corrected.hash}`
    : `/chat/main/~key/${own}`;
  loc.replace(target);
  return true;
}
