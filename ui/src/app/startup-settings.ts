// Control UI startup settings resolve native auth handoff and URL parameters.
import { normalizeOptionalString } from "../lib/string-coerce.ts";
import type { UiSettings } from "./settings.ts";

type ApplicationStartupLocation = {
  pathname: string;
  search: string;
  hash: string;
};

type NativeControlAuth = {
  gatewayUrl?: string | null;
  token?: string | null;
  password?: string | null;
};

type ApplicationStartupSettings = {
  settings: UiSettings;
  password: string | null;
  pendingGatewayUrl: string | null;
  pendingGatewayToken: string | null;
  pendingBootstrapToken: string | null;
  queryTokenUsed: boolean;
  autoConnect: boolean;
  location: ApplicationStartupLocation;
  changed: boolean;
};

declare global {
  interface Window {
    __OPENCLAW_NATIVE_CONTROL_AUTH__?: NativeControlAuth;
  }
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
  location: ApplicationStartupLocation,
): ApplicationStartupSettings {
  let settings = initialSettings;
  let changed = false;
  let password: string | null = null;
  let pendingGatewayUrl: string | null = null;
  let pendingGatewayToken: string | null = null;
  let pendingBootstrapToken: string | null = null;
  let queryTokenUsed = false;
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

  const nativeAuth =
    typeof window === "undefined" ? undefined : window["__OPENCLAW_NATIVE_CONTROL_AUTH__"];
  if (nativeAuth) {
    try {
      delete window["__OPENCLAW_NATIVE_CONTROL_AUTH__"];
    } catch {
      window["__OPENCLAW_NATIVE_CONTROL_AUTH__"] = undefined;
    }

    const gatewayUrl = normalizeOptionalString(nativeAuth.gatewayUrl);
    const token = normalizeOptionalString(nativeAuth.token);
    const nativePassword = normalizeOptionalString(nativeAuth.password);
    updateSettings({
      ...(gatewayUrl ? { gatewayUrl } : {}),
      ...(token ? { token } : {}),
    });
    if (nativePassword) {
      password = nativePassword;
    }
    if (token || nativePassword) {
      autoConnect = true;
    }
  }

  if (!location.search && !location.hash) {
    return {
      settings,
      password,
      pendingGatewayUrl,
      pendingGatewayToken,
      pendingBootstrapToken,
      queryTokenUsed,
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

  const configPayload = decodeConfigPayload(readParam(params, hashParams, "config"));
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
    params.delete("config");
    hashParams.delete("config");
  }

  const gatewayUrlRaw = readParam(params, hashParams, "gatewayUrl", "url");
  const nextGatewayUrl = normalizeOptionalString(gatewayUrlRaw) ?? "";
  const gatewayUrlChanged = Boolean(nextGatewayUrl && nextGatewayUrl !== settings.gatewayUrl);
  const queryToken = params.get("token") ?? params.get("gatewayToken");
  const hashToken = hashParams.get("token") ?? hashParams.get("gatewayToken");
  const hasTokenParam = hashToken != null || queryToken != null;
  const token = normalizeOptionalString(hashToken ?? queryToken);
  const hasBootstrapTokenParam = hashParams.has("bootstrapToken");
  const bootstrapToken = normalizeOptionalString(hashParams.get("bootstrapToken"));
  const session = normalizeOptionalString(params.get("session") ?? hashParams.get("session"));
  const autoConnectParam = readParam(params, hashParams, "autoConnect", "autoApprove");
  if (autoConnectParam && ["1", "true", "yes"].includes(autoConnectParam.trim().toLowerCase())) {
    autoConnect = true;
  }
  const shouldResetSessionForToken = Boolean(token && !session && !gatewayUrlChanged);
  let shouldCleanUrl = false;

  if (params.has("token") || params.has("gatewayToken")) {
    params.delete("token");
    params.delete("gatewayToken");
    shouldCleanUrl = true;
  }

  if (hasTokenParam) {
    if (queryToken != null) {
      queryTokenUsed = true;
      console.warn(
        "[openclaw] Auth token passed as query parameter (?token=). Use URL fragment instead: #token=<token>. Query parameters may appear in server logs.",
      );
    }
    // Auto-login handoff: apply gateway URL + token immediately so Control UI connects
    // without waiting for a manual confirm dialog.
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
    hashParams.delete("token");
    hashParams.delete("gatewayToken");
    shouldCleanUrl = true;
  }

  if (hasBootstrapTokenParam) {
    pendingBootstrapToken = bootstrapToken ?? null;
    hashParams.delete("bootstrapToken");
    shouldCleanUrl = true;
  }

  if (shouldResetSessionForToken) {
    updateSettings({
      sessionKey: "main",
      lastActiveSessionKey: "main",
    });
  }

  const passwordRaw = readParam(params, hashParams, "password");
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
    params.delete("password");
    hashParams.delete("password");
    shouldCleanUrl = true;
  }

  if (session) {
    updateSettings({
      sessionKey: session,
      lastActiveSessionKey: session,
    });
  }

  if (gatewayUrlRaw != null) {
    if (token || password || autoConnect) {
      // Prefer immediate apply for SSO/auto-login links from PHHotel.
      if (nextGatewayUrl) {
        updateSettings({ gatewayUrl: nextGatewayUrl });
      }
      pendingGatewayUrl = null;
      if (!token) {
        pendingGatewayToken = null;
      }
    } else {
      pendingGatewayUrl = gatewayUrlChanged ? nextGatewayUrl : null;
      if (!gatewayUrlChanged) {
        pendingGatewayToken = null;
      } else if (pendingBootstrapToken) {
        pendingGatewayToken = null;
      }
    }
    params.delete("gatewayUrl");
    params.delete("url");
    hashParams.delete("gatewayUrl");
    hashParams.delete("url");
    params.delete("autoConnect");
    params.delete("autoApprove");
    hashParams.delete("autoConnect");
    hashParams.delete("autoApprove");
    shouldCleanUrl = true;
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
    queryTokenUsed,
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
