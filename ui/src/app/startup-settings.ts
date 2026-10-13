import {
  normalizeGatewayClientId,
  normalizeGatewayClientMode,
} from "@openclaw/gateway-protocol/client-info";
import { normalizeOptionalString } from "@openclaw/normalization-core/string-coerce";
import { normalizeUniqueTrimmedStringList } from "@openclaw/normalization-core/string-normalization";
import { buildControlUiFocusPath } from "@openclaw/session-url-contract";
import type { RouteLocation } from "@openclaw/uirouter";
import {
  CONTROL_UI_BOOTSTRAP_PROFILE_FRAGMENT_PARAM,
  CONTROL_UI_OWNER_BOOTSTRAP_PROFILE_HINT,
  type ControlUiBootstrapProfileHint,
} from "../../../src/gateway/control-ui-bootstrap-contract.js";
import type { GatewayBrowserClientOptions } from "../api/gateway.ts";
import { inferBasePathFromPathname, sessionRouteNamespaceFromPath } from "../app-route-paths.ts";
import { storeAimarketsTicket, syncAimarketsTicketCookie } from "./aimarkets-ticket.ts";
import { createNativeGatewayConnectAuth } from "./native-gateway-auth.ts";
import { isRemoteControlUiIngress } from "./remote-ingress.ts";
import {
  resolveGatewayCredentialsForUrlEdit,
  resolvePageGatewaySettings,
  type UiSettings,
} from "./settings.ts";

type NativeControlAuth = {
  gatewayUrl?: string | null;
  nativeConnectAuth?: boolean;
  token?: string | null;
  password?: string | null;
  client?: {
    id?: string | null;
    mode?: string | null;
    platform?: string | null;
    deviceFamily?: string | null;
    instanceId?: string | null;
    scopes?: unknown;
  } | null;
};

type NativeGatewayClientOptions = Pick<
  GatewayBrowserClientOptions,
  | "clientName"
  | "mode"
  | "platform"
  | "deviceFamily"
  | "instanceId"
  | "scopes"
  | "nativeConnectAuth"
>;

declare global {
  interface Window {
    __OPENCLAW_NATIVE_CONTROL_AUTH__?: NativeControlAuth;
  }
}

export function normalizeLegacyTerminalViewLocation(
  location: RouteLocation,
  basePath: string,
): RouteLocation {
  const applicationRoot = basePath ? `${basePath}/` : "/";
  if (location.pathname !== applicationRoot) {
    return location;
  }
  const searchParams = new URLSearchParams(location.search);
  if (searchParams.get("view") !== "terminal") {
    return location;
  }
  searchParams.delete("view");
  const search = searchParams.toString();
  return {
    pathname: buildControlUiFocusPath({ kind: "terminal" }, basePath),
    search: search ? `?${search}` : "",
    hash: location.hash,
  };
}

function decodeConfigPayload(raw: string | null): Record<string, unknown> | null {
  const value = normalizeOptionalString(raw);
  if (!value) {
    return null;
  }
  try {
    const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
    const json = globalThis.atob(padded);
    const parsed = JSON.parse(json) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * PHHotel gateway host: https://{tenantId}.phhotel.vn
 * tenantId === hotelId (Mongo ObjectId 24 hex) — KHÔNG phải userId.
 */
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

/** Session chưa gắn hotel (main / agent:*:main). */
export function isPhhotelUnscopedMainSession(key: string | undefined | null): boolean {
  if (!key || !String(key).trim()) {
    return true;
  }
  const k = String(key).trim().toLowerCase();
  return k === "main" || /^agent:[^:]+:main$/.test(k);
}

/**
 * Trên domain {tenantId}.phhotel.vn: buộc session hotel-<tenantId>
 * thay vì main / agent:main:main (để phhotel-usage trừ hạn ngạch đúng).
 */
export function resolvePhhotelScopedSessionKey(
  currentSessionKey: string | undefined | null,
  ...hostCandidates: Array<string | null | undefined>
): string | undefined {
  const hotelId = parsePhhotelTenantHotelId(...hostCandidates);
  if (!hotelId) {
    return undefined;
  }
  const current = normalizeOptionalString(currentSessionKey) ?? "";
  if (!current || isPhhotelUnscopedMainSession(current)) {
    return `hotel-${hotelId}`;
  }
  if (!/(?:^|[:/_-])(?:hotel|phhotel)[:_-]/i.test(current)) {
    return `hotel-${hotelId}`;
  }
  return undefined;
}

/**
 * AI Markets gateway host: https://{userId}.openclaw.aimarkets.vn
 * userId === marketplace buyer Mongo ObjectId (24 hex). Separate from PHHotel hotelId.
 */
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

/**
 * On {userId}.openclaw.aimarkets.vn: force session market-<userId>
 * so PHHotel quota plugin does not treat the buyer as a hotel.
 */
export function resolveAimarketsScopedSessionKey(
  currentSessionKey: string | undefined | null,
  ...hostCandidates: Array<string | null | undefined>
): string | undefined {
  const userId = parseAimarketsUserId(...hostCandidates);
  if (!userId) {
    return undefined;
  }
  const current = normalizeOptionalString(currentSessionKey) ?? "";
  if (!current || isPhhotelUnscopedMainSession(current)) {
    return `market-${userId}`;
  }
  if (!/(?:^|[:/_-])market[:_-]/i.test(current)) {
    return `market-${userId}`;
  }
  return undefined;
}

function readParam(
  params: URLSearchParams,
  hashParams: URLSearchParams,
  ...keys: string[]
): string | null {
  for (const key of keys) {
    const value = params.get(key) ?? hashParams.get(key);
    if (value != null) {
      return value;
    }
  }
  return null;
}

export function resolveApplicationStartupSettings(
  initialSettings: UiSettings,
  location: RouteLocation,
) {
  const remoteIngress = isRemoteControlUiIngress();
  let settings = remoteIngress
    ? { ...resolvePageGatewaySettings(initialSettings), token: "" }
    : initialSettings;
  let changed = remoteIngress;
  let password: string | null = null;
  let pendingGatewayUrl: string | null = null;
  let pendingGatewayToken: string | null = null;
  let pendingBootstrapToken: string | null = null;
  let pendingBootstrapProfile: ControlUiBootstrapProfileHint | null = null;
  let nativeClient: NativeGatewayClientOptions | null = null;
  // Fork (PHHotel / AI Markets): connect immediately after credential handoff.
  let autoConnect = false;

  const updateSettings = (patch: Partial<UiSettings>) => {
    const entries = Object.entries(patch) as Array<
      [keyof UiSettings, UiSettings[keyof UiSettings]]
    >;
    if (entries.every(([key, value]) => settings[key] === value)) {
      return;
    }
    settings = { ...settings, ...patch };
    changed = true;
  };

  const injectedNativeAuth =
    remoteIngress || typeof window === "undefined"
      ? undefined
      : window["__OPENCLAW_NATIVE_CONTROL_AUTH__"];
  // Older Android WebViews cannot inject at document start. This public marker
  // selects native-only auth immediately; authority arrives over a main-frame port.
  // Keep the marker in the URL so a reload cannot start a browser pairing flow.
  const nativePortGateway =
    !remoteIngress && new URLSearchParams(location.hash.replace(/^#/, "")).get("nativeControlAuth");
  const nativeAuth =
    injectedNativeAuth ??
    (nativePortGateway ? { gatewayUrl: nativePortGateway, nativeConnectAuth: true } : undefined);
  if (nativeAuth) {
    try {
      delete window["__OPENCLAW_NATIVE_CONTROL_AUTH__"];
    } catch {
      window["__OPENCLAW_NATIVE_CONTROL_AUTH__"] = undefined;
    }

    const gatewayUrl = normalizeOptionalString(nativeAuth.gatewayUrl);
    const token = normalizeOptionalString(nativeAuth.token);
    const nativePassword = normalizeOptionalString(nativeAuth.password);
    const credentials = gatewayUrl
      ? resolveGatewayCredentialsForUrlEdit(settings.gatewayUrl, gatewayUrl, {
          token: settings.token,
          password: "",
        })
      : null;
    const client = nativeAuth.client;
    const clientName = normalizeGatewayClientId(client?.id);
    const mode = normalizeGatewayClientMode(client?.mode);
    const platform = normalizeOptionalString(client?.platform);
    const deviceFamily = normalizeOptionalString(client?.deviceFamily);
    const instanceId = normalizeOptionalString(client?.instanceId);
    const scopes = normalizeUniqueTrimmedStringList(client?.scopes);
    if (clientName && mode && platform && deviceFamily && scopes.length > 0) {
      nativeClient = {
        clientName,
        mode,
        platform,
        deviceFamily,
        ...(instanceId ? { instanceId } : {}),
        scopes,
      };
    }
    if (nativeAuth.nativeConnectAuth === true && gatewayUrl) {
      nativeClient = {
        nativeConnectAuth: createNativeGatewayConnectAuth(gatewayUrl, {
          messagePort: !injectedNativeAuth && Boolean(nativePortGateway),
        }),
      };
    }
    updateSettings({
      ...(gatewayUrl ? { gatewayUrl } : {}),
      // An explicit null retires shared-owner auth for the native browser sign-in
      // route; an omitted token still preserves the selected Gateway's credentials.
      ...(nativeAuth.nativeConnectAuth === true
        ? { token: "" }
        : nativeAuth.token === null || token
          ? { token: token ?? "" }
          : credentials
            ? { token: credentials.token }
            : {}),
    });
    if (nativePassword && nativeAuth.nativeConnectAuth !== true) {
      password = nativePassword;
    }
    if ((token || nativePassword) && nativeAuth.nativeConnectAuth !== true) {
      autoConnect = true;
    }
  }

  if (!location.search && !location.hash) {
    syncAimarketsTicketCookie();
    return {
      settings,
      password,
      pendingGatewayUrl,
      pendingGatewayToken,
      pendingBootstrapToken,
      pendingBootstrapProfile,
      nativeClient,
      autoConnect,
      location,
      changed,
    };
  }

  const url = new URL(
    `${location.pathname}${location.search}${location.hash}`,
    "http://openclaw.local",
  );
  const params = new URLSearchParams(url.search);
  const hashParams = new URLSearchParams(url.hash.startsWith("#") ? url.hash.slice(1) : url.hash);

  // Fork (PHHotel): `config` is a base64url JSON launch payload carrying
  // gatewayUrl/url, token/gatewayToken, password and autoConnect.
  const configPayload = remoteIngress
    ? null
    : decodeConfigPayload(readParam(params, hashParams, "config"));
  if (configPayload) {
    if (
      !params.get("gatewayUrl") &&
      !hashParams.get("gatewayUrl") &&
      typeof configPayload.gatewayUrl === "string"
    ) {
      hashParams.set("gatewayUrl", configPayload.gatewayUrl);
    }
    if (!params.get("url") && !hashParams.get("url") && typeof configPayload.url === "string") {
      hashParams.set("url", configPayload.url);
    }
    if (
      !params.get("token") &&
      !hashParams.get("token") &&
      !params.get("gatewayToken") &&
      !hashParams.get("gatewayToken")
    ) {
      const configToken =
        (typeof configPayload.gatewayToken === "string" && configPayload.gatewayToken) ||
        (typeof configPayload.token === "string" && configPayload.token) ||
        "";
      if (configToken) {
        hashParams.set("token", configToken);
      }
    }
    if (
      !params.get("password") &&
      !hashParams.get("password") &&
      typeof configPayload.password === "string" &&
      configPayload.password
    ) {
      hashParams.set("password", configPayload.password);
    }
    if (configPayload.autoConnect === true || configPayload.autoConnect === "true") {
      autoConnect = true;
    }
  }

  const gatewayUrlRaw = remoteIngress ? null : readParam(params, hashParams, "gatewayUrl", "url");
  const nextGatewayUrl = normalizeOptionalString(gatewayUrlRaw) ?? "";
  const gatewayUrlChanged = Boolean(nextGatewayUrl && nextGatewayUrl !== settings.gatewayUrl);
  const queryToken = params.get("token") ?? params.get("gatewayToken");
  const hashToken = hashParams.get("token") ?? hashParams.get("gatewayToken");
  const hasTokenParam = hashToken != null || queryToken != null;
  const token = remoteIngress ? undefined : normalizeOptionalString(hashToken ?? queryToken);
  const hasBootstrapTokenParam = !remoteIngress && hashParams.has("bootstrapToken");
  const bootstrapToken = normalizeOptionalString(hashParams.get("bootstrapToken"));
  const bootstrapProfile = normalizeOptionalString(
    hashParams.get(CONTROL_UI_BOOTSTRAP_PROFILE_FRAGMENT_PARAM),
  );
  const sessionPath = sessionRouteNamespaceFromPath(
    location.pathname,
    inferBasePathFromPathname(location.pathname),
  );
  const session = remoteIngress
    ? undefined
    : normalizeOptionalString(params.get("session") ?? hashParams.get("session"));
  const hotelIdParam = remoteIngress
    ? undefined
    : normalizeOptionalString(
        readParam(params, hashParams, "hotelId", "hotel_id", "tenant_id", "tenantId"),
      );
  const userIdParam = remoteIngress
    ? undefined
    : normalizeOptionalString(readParam(params, hashParams, "userId", "user_id"));
  // hotelId = tenantId on the gateway subdomain, e.g. https://<24hex>.phhotel.vn/
  const hotelIdFromDomain = parsePhhotelTenantHotelId(
    globalThis.location?.hostname,
    nextGatewayUrl,
    gatewayUrlRaw,
    settings.gatewayUrl,
  );
  const hotelIdHint = hotelIdParam || hotelIdFromDomain;
  const autoConnectParam = remoteIngress
    ? null
    : readParam(params, hashParams, "autoConnect", "autoApprove");
  if (autoConnectParam && ["1", "true", "yes"].includes(autoConnectParam.trim().toLowerCase())) {
    autoConnect = true;
  }
  const shouldResetSessionForToken = Boolean(
    token && !sessionPath && !session && !hotelIdHint && !gatewayUrlChanged,
  );
  if (hasTokenParam) {
    if (queryToken != null) {
      console.warn(
        "[openclaw] Auth token passed as query parameter (?token=). Use URL fragment instead: #token=<token>. Query parameters may appear in server logs.",
      );
    }
    // Fork (PHHotel auto-login handoff): apply gateway URL + token immediately so
    // Control UI connects without the manual gateway-change confirm dialog.
    if (token && nextGatewayUrl) {
      updateSettings({ gatewayUrl: nextGatewayUrl, token });
      pendingGatewayUrl = null;
      pendingGatewayToken = null;
      autoConnect = true;
    } else if (token && gatewayUrlChanged) {
      pendingGatewayToken = token;
      autoConnect = true;
    } else if (token) {
      updateSettings({ token });
      autoConnect = true;
    }
  }

  if (hasBootstrapTokenParam) {
    pendingBootstrapToken = bootstrapToken ?? null;
    pendingBootstrapProfile =
      bootstrapToken && bootstrapProfile === CONTROL_UI_OWNER_BOOTSTRAP_PROFILE_HINT
        ? CONTROL_UI_OWNER_BOOTSTRAP_PROFILE_HINT
        : null;
  }

  if (shouldResetSessionForToken) {
    updateSettings({
      sessionKey: "main",
      lastActiveSessionKey: "main",
    });
  }

  let shouldCleanUrl = false;
  const passwordRaw = remoteIngress ? null : readParam(params, hashParams, "password");
  if (passwordRaw != null) {
    const passwordFromUrl = normalizeOptionalString(passwordRaw);
    if (passwordFromUrl) {
      password = passwordFromUrl;
      autoConnect = true;
      // Gateway password auth mode: also mirror into token if token missing.
      if (!settings.token) {
        updateSettings({ token: passwordFromUrl });
      }
    }
  }

  // PHHotel: session must be hotel-<tenantId> so phhotel-usage can check quota + record tokens.
  // tenantId === hotelId, lấy từ hash/query hoặc từ hostname {tenantId}.phhotel.vn
  const PHHOTEL_CTX_KEY = "openclaw.phhotel.context.v1";
  const sessionHasHotel = (key: string | undefined | null): boolean =>
    /(?:^|[:/_-])(?:hotel|phhotel)[:_-]/i.test(String(key || ""));
  const buildHotelSession = (hotelId: string, userId?: string | null): string =>
    userId ? `hotel-${hotelId}__u-${userId}` : `hotel-${hotelId}`;

  let resolvedHotelId = hotelIdHint;
  let resolvedUserId = userIdParam;
  if (resolvedHotelId) {
    try {
      globalThis.localStorage?.setItem(
        PHHOTEL_CTX_KEY,
        JSON.stringify({ hotelId: resolvedHotelId, userId: resolvedUserId || null }),
      );
    } catch {
      // ignore
    }
  } else {
    try {
      const raw = globalThis.localStorage?.getItem(PHHOTEL_CTX_KEY);
      const parsed = raw ? (JSON.parse(raw) as { hotelId?: string; userId?: string | null }) : null;
      if (parsed?.hotelId && typeof parsed.hotelId === "string") {
        resolvedHotelId = normalizeOptionalString(parsed.hotelId) ?? undefined;
        resolvedUserId = normalizeOptionalString(parsed.userId) ?? resolvedUserId ?? undefined;
      }
    } catch {
      // ignore
    }
  }

  let effectiveSession = session;
  // Domain {tenantId}.phhotel.vn luôn thắng session=main trên query string
  if (!resolvedHotelId) {
    resolvedHotelId = parsePhhotelTenantHotelId(
      globalThis.location?.hostname,
      globalThis.location?.host,
      nextGatewayUrl,
      gatewayUrlRaw,
      settings.gatewayUrl,
    );
  }

  if (resolvedHotelId) {
    if (
      !effectiveSession ||
      isPhhotelUnscopedMainSession(effectiveSession) ||
      !sessionHasHotel(effectiveSession)
    ) {
      effectiveSession = buildHotelSession(resolvedHotelId, resolvedUserId);
    }
    hashParams.set("hotelId", resolvedHotelId);
    if (resolvedUserId) {
      hashParams.set("userId", resolvedUserId);
    }
    hashParams.set("session", effectiveSession);
    // Ghi đè ?session=agent:main:main — nếu chỉ delete thì app-host đọc URL cũ sẽ về main
    params.set("session", effectiveSession);
    shouldCleanUrl = true;
  }

  // AI Markets: {userId}.openclaw.aimarkets.vn — never overwrite a PHHotel hotel session.
  if (!resolvedHotelId) {
    const AIMARKETS_CTX_KEY = "openclaw.aimarkets.context.v1";
    let resolvedMarketUserId =
      userIdParam ||
      parseAimarketsUserId(
        globalThis.location?.hostname,
        globalThis.location?.host,
        nextGatewayUrl,
        gatewayUrlRaw,
        settings.gatewayUrl,
      );
    if (resolvedMarketUserId) {
      try {
        globalThis.localStorage?.setItem(
          AIMARKETS_CTX_KEY,
          JSON.stringify({ userId: resolvedMarketUserId }),
        );
      } catch {
        // ignore
      }
    } else {
      try {
        const raw = globalThis.localStorage?.getItem(AIMARKETS_CTX_KEY);
        const parsed = raw ? (JSON.parse(raw) as { userId?: string | null }) : null;
        if (parsed?.userId && typeof parsed.userId === "string") {
          resolvedMarketUserId = normalizeOptionalString(parsed.userId) ?? undefined;
        }
      } catch {
        // ignore
      }
    }
    const marketTicket = readParam(params, hashParams, "marketTicket");
    if (marketTicket != null) {
      storeAimarketsTicket(marketTicket);
      params.delete("marketTicket");
      hashParams.delete("marketTicket");
      shouldCleanUrl = true;
    } else {
      syncAimarketsTicketCookie(resolvedMarketUserId);
    }
    if (resolvedMarketUserId) {
      if (
        !effectiveSession ||
        isPhhotelUnscopedMainSession(effectiveSession) ||
        !/(?:^|[:/_-])market[:_-]/i.test(effectiveSession)
      ) {
        effectiveSession = `market-${resolvedMarketUserId}`;
      }
      hashParams.set("userId", resolvedMarketUserId);
      hashParams.set("session", effectiveSession);
      params.set("session", effectiveSession);
      shouldCleanUrl = true;
    }
  }

  if (effectiveSession) {
    updateSettings({
      sessionKey: effectiveSession,
      lastActiveSessionKey: effectiveSession,
    });
  }

  if (gatewayUrlRaw != null) {
    if (token) {
      // Fork: a launch link that carries its own token for this gateway applies
      // immediately (PHHotel SSO). Without a URL token, a gateway change stays
      // pending so stored credentials are re-scoped and never sent elsewhere.
      if (nextGatewayUrl) {
        updateSettings({ gatewayUrl: nextGatewayUrl });
      }
      pendingGatewayUrl = null;
      if (!token) {
        pendingGatewayToken = null;
      }
    } else {
      pendingGatewayUrl = gatewayUrlChanged ? nextGatewayUrl : null;
      if (!gatewayUrlChanged || pendingBootstrapToken) {
        pendingGatewayToken = null;
      }
    }
  }

  for (const source of [params, hashParams]) {
    const keys = [
      "token",
      "gatewayToken",
      "password",
      "gatewayUrl",
      "url",
      "config",
      "autoConnect",
      "autoApprove",
    ];
    if (source === hashParams) {
      keys.push("bootstrapToken", CONTROL_UI_BOOTSTRAP_PROFILE_FRAGMENT_PARAM);
    }
    for (const key of keys) {
      if (source.has(key)) {
        source.delete(key);
        shouldCleanUrl = true;
      }
    }
  }

  if (shouldCleanUrl) {
    url.search = params.toString();
    const nextHash = hashParams.toString();
    url.hash = nextHash ? `#${nextHash}` : "";
  }

  return {
    settings,
    password,
    pendingGatewayUrl,
    pendingGatewayToken,
    pendingBootstrapToken,
    pendingBootstrapProfile,
    nativeClient,
    autoConnect,
    location: shouldCleanUrl
      ? {
          pathname: url.pathname,
          search: url.search,
          hash: url.hash,
        }
      : location,
    changed,
  };
}
