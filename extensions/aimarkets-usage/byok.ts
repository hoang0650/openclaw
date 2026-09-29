/**
 * Bring-your-own-key support for AI Markets sessions.
 *
 * Buyers store provider API keys in ai-marketplace-api (/v1/openclaw/byok).
 * This module fetches them per user (short cache) and registers a session
 * credential resolver with the core runner through the global registry
 * (see src/agents/session-credential-resolver.ts).
 */

/** Provider ids that accept buyer-owned keys. Must match ai-marketplace-api BYOK_PROVIDERS. */
export const BYOK_PROVIDER_IDS = new Set([
  "openai",
  "anthropic",
  "google",
  "openrouter",
  "deepseek",
  "groq",
  "xai",
  "byok-custom",
]);

export const BYOK_CUSTOM_PROVIDER_ID = "byok-custom";

export type ByokKey = { apiKey: string; baseUrl?: string; model?: string };
export type ByokKeyMap = Record<string, ByokKey>;

type CacheEntry = { at: number; keys: ByokKeyMap };

const CACHE_TTL_MS = 30_000;
const FETCH_TIMEOUT_MS = 8_000;
const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<ByokKeyMap>>();

export function isOpenRouterFreeModel(provider: string, modelId: string): boolean {
  if (String(provider || "").toLowerCase() !== "openrouter") return false;
  const id = String(modelId || "")
    .trim()
    .replace(/^openrouter\//i, "");
  return /:free$/i.test(id) || id === "free";
}

function sanitizeKeys(raw: unknown): ByokKeyMap {
  const out: ByokKeyMap = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [provider, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!BYOK_PROVIDER_IDS.has(provider) || !value || typeof value !== "object") continue;
    const entry = value as Record<string, unknown>;
    const apiKey = typeof entry.apiKey === "string" ? entry.apiKey.trim() : "";
    if (!apiKey) continue;
    out[provider] = {
      apiKey,
      ...(typeof entry.baseUrl === "string" && entry.baseUrl.trim()
        ? { baseUrl: entry.baseUrl.trim() }
        : {}),
      ...(typeof entry.model === "string" && entry.model.trim()
        ? { model: entry.model.trim() }
        : {}),
    };
  }
  return out;
}

async function fetchKeys(params: {
  apiBaseUrl: string;
  serviceSecret: string;
  userId: string;
}): Promise<ByokKeyMap> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const url = `${params.apiBaseUrl}/v1/openclaw/byok/resolve?user_id=${encodeURIComponent(params.userId)}`;
    const res = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        ...(params.serviceSecret ? { "X-Service-Secret": params.serviceSecret } : {}),
      },
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(`BYOK key store responded HTTP ${res.status}`);
    }
    const data = (await res.json().catch(() => ({}))) as { keys?: unknown };
    return sanitizeKeys(data.keys);
  } finally {
    clearTimeout(timer);
  }
}

/** Returns the buyer's active provider keys. Throws when the key store is unreachable. */
export async function getUserKeys(params: {
  apiBaseUrl: string;
  serviceSecret: string;
  userId: string;
  fresh?: boolean;
}): Promise<ByokKeyMap> {
  const userId = params.userId.toLowerCase();
  const cached = cache.get(userId);
  if (!params.fresh && cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return cached.keys;
  }
  const pending = inflight.get(userId);
  if (pending) return pending;
  const request = fetchKeys({ ...params, userId })
    .then((keys) => {
      cache.set(userId, { at: Date.now(), keys });
      return keys;
    })
    .finally(() => inflight.delete(userId));
  inflight.set(userId, request);
  return request;
}

/** Last known keys without network access (usage reporting only). */
export function peekUserKeys(userId: string): ByokKeyMap | undefined {
  return cache.get(String(userId || "").toLowerCase())?.keys;
}

type SessionCredentialResolver = (request: {
  sessionKey: string;
  provider: string;
  modelId: string;
}) => Promise<{ apiKey: string; baseUrl?: string; modelId?: string; source?: string } | null>;

const RESOLVER_REGISTRY_KEY = Symbol.for("openclaw.sessionCredentialResolvers");

/** Registers with the core runner without importing core internals. */
export function registerCredentialResolver(id: string, resolver: SessionCredentialResolver): void {
  const host = globalThis as typeof globalThis & {
    [RESOLVER_REGISTRY_KEY]?: Map<string, SessionCredentialResolver>;
  };
  host[RESOLVER_REGISTRY_KEY] ??= new Map();
  host[RESOLVER_REGISTRY_KEY].set(id, resolver);
}
