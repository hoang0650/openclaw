// AI Markets key vault client (ai-marketplace-api /v1/openclaw/byok).
export type ByokProvider = {
  id: string;
  label: string;
  keyUrl: string;
  keyHint?: string;
  custom?: boolean;
};

export type ByokKey = {
  provider: string;
  last4: string;
  baseUrl: string;
  model: string;
  status: "active" | "invalid";
  lastVerifiedAt: string | null;
  lastUsedAt: string | null;
  updatedAt: string | null;
};

const API_OVERRIDE_STORAGE_KEY = "openclaw.aimarkets.api.v1";
const DEFAULT_API_BASE = "https://api.aimarkets.vn";

/** Model aliases in openclaw.json served by each BYOK provider. */
export const BYOK_PROVIDER_MODELS: Readonly<Record<string, readonly string[]>> = {
  openai: ["aimarkets-byok-openai", "aimarkets-byok-openai-mini"],
  anthropic: [
    "aimarkets-byok-claude-sonnet",
    "aimarkets-byok-claude-opus",
    "aimarkets-byok-claude-haiku",
  ],
  google: ["aimarkets-byok-gemini-pro", "aimarkets-byok-gemini-flash"],
  openrouter: ["aimarkets-byok-openrouter-auto"],
  deepseek: ["aimarkets-byok-deepseek-pro", "aimarkets-byok-deepseek-flash"],
  groq: ["aimarkets-byok-groq-llama", "aimarkets-byok-groq-gpt-oss"],
  xai: ["aimarkets-byok-grok"],
  "byok-custom": ["aimarkets-byok-custom"],
};

export function resolveMarketApiBase(): string {
  try {
    const override = globalThis.localStorage?.getItem(API_OVERRIDE_STORAGE_KEY)?.trim();
    if (override && /^https:\/\//i.test(override)) {
      return override.replace(/\/+$/, "");
    }
  } catch {
    // ignore storage errors
  }
  return DEFAULT_API_BASE;
}

export class ByokApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = "ByokApiError";
  }
}

async function request<T>(
  ticket: string | null,
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (ticket) {
    headers["X-Market-Ticket"] = ticket;
  }
  if (init.body !== undefined) {
    headers["Content-Type"] = "application/json";
  }
  const res = await fetch(`${resolveMarketApiBase()}/v1/openclaw/byok${path}`, {
    method: init.method ?? "GET",
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    credentials: "omit",
    cache: "no-store",
  });
  const data = (await res.json().catch(() => ({}))) as {
    success?: boolean;
    message?: string;
    code?: string;
  } & T;
  if (!res.ok || data.success === false) {
    throw new ByokApiError(data.message || `HTTP ${res.status}`, res.status, data.code);
  }
  return data;
}

export async function listProviders(): Promise<ByokProvider[]> {
  const data = await request<{ providers?: ByokProvider[] }>(null, "/providers");
  return Array.isArray(data.providers) ? data.providers : [];
}

export async function listKeys(ticket: string): Promise<ByokKey[]> {
  const data = await request<{ keys?: ByokKey[] }>(ticket, "/keys");
  return Array.isArray(data.keys) ? data.keys : [];
}

export async function saveKey(
  ticket: string,
  provider: string,
  body: { apiKey?: string; baseUrl?: string; model?: string },
): Promise<ByokKey> {
  const data = await request<{ key: ByokKey }>(ticket, `/keys/${encodeURIComponent(provider)}`, {
    method: "PUT",
    body,
  });
  return data.key;
}

export async function testKey(ticket: string, provider: string): Promise<ByokKey> {
  const data = await request<{ key: ByokKey }>(
    ticket,
    `/keys/${encodeURIComponent(provider)}/test`,
    { method: "POST" },
  );
  return data.key;
}

export async function deleteKey(ticket: string, provider: string): Promise<void> {
  await request(ticket, `/keys/${encodeURIComponent(provider)}`, { method: "DELETE" });
}
