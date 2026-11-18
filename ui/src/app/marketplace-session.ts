// PHHotel and AI Markets Control UI session scoping.
// {tenantId}.phhotel.vn uses hotel-<tenantId>. {userId}.openclaw.aimarkets.vn uses market-<userId>.
import { isForeignMarketSession } from "./aimarkets-session-guard.ts";
import { storeAimarketsTicket, syncAimarketsTicketCookie } from "./aimarkets-ticket.ts";
import type { UiSettings } from "./settings.ts";

function normalizeOptionalString(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export function decodeConfigPayload(raw: string | null): Record<string, unknown> | null {
  const value = normalizeOptionalString(raw);
  if (!value) {
    return null;
  }
  try {
    const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
    const parsed = JSON.parse(globalThis.atob(padded)) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export function parsePhhotelTenantHotelId(
  ...values: Array<string | null | undefined>
): string | undefined {
  for (const value of values) {
    const raw = normalizeOptionalString(value);
    if (!raw) {
      continue;
    }
    try {
      const host = raw.includes("://")
        ? new URL(raw).hostname
        : raw.split("/")[0]?.split(":")[0] || "";
      const fromSubdomain = /^([a-f0-9]{24})\.phhotel\.vn$/i.exec(host);
      if (fromSubdomain?.[1]) {
        return fromSubdomain[1].toLowerCase();
      }
    } catch {
      // ignore invalid URL
    }
  }
  return undefined;
}

export function isPhhotelUnscopedMainSession(key: string | undefined | null): boolean {
  if (!key || !String(key).trim()) {
    return true;
  }
  const normalized = String(key).trim().toLowerCase();
  return normalized === "main" || /^agent:[^:]+:main$/.test(normalized);
}

export function resolvePhhotelScopedSessionKey(
  currentSessionKey: string | undefined | null,
  ...hostCandidates: Array<string | null | undefined>
): string | undefined {
  const hotelId = parsePhhotelTenantHotelId(...hostCandidates);
  if (!hotelId) {
    return undefined;
  }
  const current = normalizeOptionalString(currentSessionKey) ?? "";
  if (!current || isPhhotelUnscopedMainSession(current) || !/(?:^|[:/_-])(?:hotel|phhotel)[:_-]/i.test(current)) {
    return `hotel-${hotelId}`;
  }
  return undefined;
}

export function parseAimarketsUserId(
  ...values: Array<string | null | undefined>
): string | undefined {
  for (const value of values) {
    const raw = normalizeOptionalString(value);
    if (!raw) {
      continue;
    }
    try {
      const host = raw.includes("://")
        ? new URL(raw).hostname
        : raw.split("/")[0]?.split(":")[0] || "";
      const fromSubdomain = /^([a-f0-9]{24})\.openclaw\.aimarkets\.vn$/i.exec(host);
      if (fromSubdomain?.[1]) {
        return fromSubdomain[1].toLowerCase();
      }
    } catch {
      // ignore invalid URL
    }
  }
  return undefined;
}

export function resolveAimarketsScopedSessionKey(
  currentSessionKey: string | undefined | null,
  ...hostCandidates: Array<string | null | undefined>
): string | undefined {
  const userId = parseAimarketsUserId(...hostCandidates);
  if (!userId) {
    return undefined;
  }
  const current = normalizeOptionalString(currentSessionKey) ?? "";
  if (
    !current ||
    isPhhotelUnscopedMainSession(current) ||
    !/(?:^|[:/_-])market[:_-]/i.test(current) ||
    isForeignMarketSession(current, userId)
  ) {
    return `market-${userId}`;
  }
  return undefined;
}

function readStoredId(storageKey: string, field: string): string | undefined {
  try {
    const raw = globalThis.localStorage?.getItem(storageKey);
    const parsed = raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
    return typeof parsed?.[field] === "string" ? normalizeOptionalString(parsed[field]) : undefined;
  } catch {
    return undefined;
  }
}

function writeStoredId(storageKey: string, value: Record<string, unknown>): void {
  try {
    globalThis.localStorage?.setItem(storageKey, JSON.stringify(value));
  } catch {
    // ignore quota and private-mode failures
  }
}

/** Forces the buyer or hotel session and stores the AI Markets launch ticket. */
export function applyForkMarketplaceSession(input: {
  settings: UiSettings;
  updateSettings: (patch: Partial<UiSettings>) => void;
  params: URLSearchParams | null;
  hashParams: URLSearchParams | null;
  nextGatewayUrl: string;
  gatewayUrlRaw: string | null;
}): { shouldCleanUrl: boolean } {
  const params = input.params;
  const hashParams = input.hashParams;
  const read = (key: string) => params?.get(key) ?? hashParams?.get(key) ?? null;
  const hosts = [
    globalThis.location?.hostname,
    globalThis.location?.host,
    input.nextGatewayUrl,
    input.gatewayUrlRaw,
    input.settings.gatewayUrl,
  ];
  let shouldCleanUrl = false;
  const hotelId =
    normalizeOptionalString(
      read("hotelId") ?? read("hotel_id") ?? read("tenantId") ?? read("tenant_id"),
    ) ||
    parsePhhotelTenantHotelId(...hosts) ||
    readStoredId("openclaw.phhotel.context.v1", "hotelId");
  if (hotelId) {
    const userId =
      normalizeOptionalString(read("userId") ?? read("user_id")) ||
      readStoredId("openclaw.phhotel.context.v1", "userId");
    writeStoredId("openclaw.phhotel.context.v1", { hotelId, userId: userId ?? null });
    const current = normalizeOptionalString(read("session")) ?? input.settings.sessionKey;
    const session =
      !current ||
      isPhhotelUnscopedMainSession(current) ||
      !/(?:^|[:/_-])(?:hotel|phhotel)[:_-]/i.test(current)
        ? userId
          ? `hotel-${hotelId}__u-${userId}`
          : `hotel-${hotelId}`
        : current;
    input.updateSettings({ sessionKey: session, lastActiveSessionKey: session });
    return { shouldCleanUrl };
  }

  const userId =
    normalizeOptionalString(read("userId") ?? read("user_id")) ||
    parseAimarketsUserId(...hosts) ||
    readStoredId("openclaw.aimarkets.context.v1", "userId");
  const marketTicket = read("marketTicket");
  if (marketTicket != null) {
    storeAimarketsTicket(marketTicket);
    params?.delete("marketTicket");
    hashParams?.delete("marketTicket");
    shouldCleanUrl = true;
  } else {
    syncAimarketsTicketCookie(userId);
  }
  if (!userId) {
    return { shouldCleanUrl };
  }
  writeStoredId("openclaw.aimarkets.context.v1", { userId });
  const current = normalizeOptionalString(read("session")) ?? input.settings.sessionKey;
  const session =
    !current ||
    isPhhotelUnscopedMainSession(current) ||
    !/(?:^|[:/_-])market[:_-]/i.test(current) ||
    isForeignMarketSession(current, userId)
      ? `market-${userId}`
      : current;
  input.updateSettings({ sessionKey: session, lastActiveSessionKey: session });
  return { shouldCleanUrl };
}
