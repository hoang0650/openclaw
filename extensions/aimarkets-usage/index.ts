/**
 * AI Markets OpenClaw usage policy.
 *
 * AI Markets sells agents only: buyers bring their own provider API keys
 * (stored in ai-marketplace-api) and pay providers directly, so BYOK runs are
 * never billed. OpenRouter free models stay available on the platform key for
 * trial users. PHHotel sessions are ignored (handled by phhotel-usage).
 */
import { definePluginEntry, type OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";
import {
  computeAimarketsSellCost,
  isAimarketsSession,
  isPhhotelModelId,
  AIMARKETS_PROVIDER_MARKUP,
} from "./audience.ts";
import {
  BYOK_CUSTOM_PROVIDER_ID,
  BYOK_PROVIDER_IDS,
  getUserKeys,
  isOpenRouterFreeModel,
  peekUserKeys,
  registerCredentialResolver,
} from "./byok.ts";

type PendingUsage = {
  input: number;
  output: number;
  model: string;
  sessionId: string;
  userId: string;
  calls: number;
  byok: boolean;
  timer?: ReturnType<typeof setTimeout>;
};

type PluginConfig = {
  apiBaseUrl?: string;
  serviceSecret?: string;
  markup?: number;
  userId?: string;
};

const pendingByRun = new Map<string, PendingUsage>();
const FLUSH_FALLBACK_MS = 45_000;
const PHHOTEL_MODEL_BLOCK =
  "This model is reserved for PHHotel. Pick one of your own-key models (aimarkets-byok-*) or a free OpenRouter model.";
const PLATFORM_MODEL_BLOCK =
  "AI Markets no longer provides paid models. Add your own provider API key in Settings → My API keys, or pick a free OpenRouter model.";
const BYOK_STORE_UNAVAILABLE =
  "Could not load your API keys from AI Markets right now. Please retry in a moment.";

function providerLabel(provider: string): string {
  const labels: Record<string, string> = {
    openai: "OpenAI",
    anthropic: "Anthropic",
    google: "Google Gemini",
    openrouter: "OpenRouter",
    deepseek: "DeepSeek",
    groq: "Groq",
    xai: "xAI",
    [BYOK_CUSTOM_PROVIDER_ID]: "Custom (OpenAI-compatible)",
  };
  return labels[provider] || provider;
}

function missingKeyMessage(provider: string): string {
  const label = providerLabel(provider);
  return `This model uses ${label} with your own API key. Add a ${label} key in Settings → My API keys, or pick a free OpenRouter model.`;
}

function splitModelRef(provider: string, model: string): { provider: string; modelId: string } {
  const p = provider.trim().toLowerCase();
  const m = model.trim();
  if (p) {
    return { provider: p, modelId: m.startsWith(`${p}/`) ? m.slice(p.length + 1) : m };
  }
  const slash = m.indexOf("/");
  if (slash > 0) {
    return { provider: m.slice(0, slash).toLowerCase(), modelId: m.slice(slash + 1) };
  }
  return { provider: "", modelId: m };
}

function readEnv(name: string): string {
  try {
    const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process
      ?.env;
    const value = env?.[name];
    return typeof value === "string" ? value.trim() : "";
  } catch {
    return "";
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function expandEnvValue(value: string): string {
  const trimmed = String(value || "").trim();
  const exact = /^\$\{([A-Z0-9_]+)\}$/.exec(trimmed);
  if (exact) return readEnv(exact[1]);
  return trimmed.replace(/\$\{([A-Z0-9_]+)\}/g, (_m, name: string) => readEnv(name) || "");
}

function readString(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      const expanded = expandEnvValue(value.trim());
      if (expanded) return expanded;
    }
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return "";
}

function readUsageTokens(usage: unknown): { input: number; output: number } {
  const u = asRecord(usage);
  const input = Math.max(
    0,
    Math.floor(
      Number(
        u.input ?? u.input_tokens ?? u.inputTokens ?? u.prompt_tokens ?? u.promptTokens ?? 0,
      ) || 0,
    ),
  );
  const cacheRead = Math.max(
    0,
    Math.floor(Number(u.cacheRead ?? u.cache_read ?? u.cache_read_input_tokens ?? 0) || 0),
  );
  const output = Math.max(
    0,
    Math.floor(
      Number(
        u.output ??
          u.output_tokens ??
          u.outputTokens ??
          u.completion_tokens ??
          u.completionTokens ??
          0,
      ) || 0,
    ),
  );
  return { input: input > 0 ? input : cacheRead, output };
}

function resolveApiBase(cfg: PluginConfig): string {
  return (
    expandEnvValue(cfg.apiBaseUrl || "") ||
    readEnv("AIMARKETS_API_URL") ||
    readEnv("AI_MARKETPLACE_API_URL") ||
    "https://api.aimarkets.vn"
  ).replace(/\/$/, "");
}

function resolveServiceSecret(cfg: PluginConfig): string {
  return (
    expandEnvValue(cfg.serviceSecret || "") ||
    readEnv("AIMARKETS_SERVICE_SECRET") ||
    readEnv("NEST_SERVICE_AUTH_SECRET") ||
    readEnv("PYTHON_AI_SHARED_SECRET") ||
    ""
  );
}

function resolveUserId(cfg: PluginConfig, sessionId: string, ctx: unknown): string {
  const fromCfg = expandEnvValue(cfg.userId || "");
  if (fromCfg) return fromCfg;
  const m = /(?:^|[:/_-])market[:_-]([a-f0-9]{24})/i.exec(sessionId);
  if (m) return m[1].toLowerCase();
  const ctxObj = asRecord(ctx);
  return readString(ctxObj.userId, ctxObj.user_id).toLowerCase();
}

/** Buyer id bound to the session key itself; never taken from mutable config. */
function sessionOwnerId(sessionKey: string): string {
  const m = /(?:^|[:/_-])market[:_-]([a-f0-9]{24})/i.exec(sessionKey);
  return m ? m[1].toLowerCase() : "";
}

function hostBits(ctx: unknown, sessionId: string): string[] {
  const ctxObj = asRecord(ctx);
  return [
    readString(ctxObj.gatewayUrl, ctxObj.host, ctxObj.hostname, ctxObj.publicUrl, ctxObj.origin),
    sessionId,
  ];
}

async function reportUsage(params: {
  apiBaseUrl: string;
  serviceSecret: string;
  userId: string;
  inputTokens: number;
  outputTokens: number;
  model: string;
  cost: number;
  markup: number;
  byok: boolean;
}): Promise<void> {
  if (!params.userId || !params.apiBaseUrl) return;
  if (params.inputTokens <= 0 && params.outputTokens <= 0 && params.cost <= 0) return;
  try {
    await fetch(`${params.apiBaseUrl}/v1/openclaw/usage`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        ...(params.serviceSecret ? { "X-Service-Secret": params.serviceSecret } : {}),
      },
      body: JSON.stringify({
        user_id: params.userId,
        userId: params.userId,
        inputTokens: params.inputTokens,
        outputTokens: params.outputTokens,
        model: params.model,
        cost: params.byok ? 0 : params.cost,
        markup: params.markup,
        byok: params.byok,
        channel: "openclaw",
        audience: "aimarkets",
      }),
    });
  } catch (err) {
    console.warn("[aimarkets-usage] report failed", err);
  }
}

export default definePluginEntry({
  id: "aimarkets-usage",
  name: "AI Markets OpenClaw Usage",
  description:
    "AI Markets policy: buyer-owned provider keys (BYOK), free OpenRouter trial, usage reporting.",
  register(api: OpenClawPluginApi) {
    const cfg = (api.pluginConfig || {}) as PluginConfig;
    const apiBaseUrl = resolveApiBase(cfg);
    const serviceSecret = resolveServiceSecret(cfg);
    const markup =
      typeof cfg.markup === "number" && Number.isFinite(cfg.markup)
        ? cfg.markup
        : AIMARKETS_PROVIDER_MARKUP;

    // Runs on every embedded run; must never hand platform credentials to a
    // BYOK provider on an AI Markets session.
    registerCredentialResolver("aimarkets-byok", async ({ sessionKey, provider, modelId }) => {
      if (!isAimarketsSession(sessionKey)) return null;
      const providerId = String(provider || "").toLowerCase();
      if (!BYOK_PROVIDER_IDS.has(providerId)) return null;
      const userId = sessionOwnerId(sessionKey);
      const freeTrial = isOpenRouterFreeModel(providerId, modelId);
      if (!userId) {
        if (freeTrial) return null;
        throw new Error(missingKeyMessage(providerId));
      }
      let keys: Awaited<ReturnType<typeof getUserKeys>>;
      try {
        keys = await getUserKeys({ apiBaseUrl, serviceSecret, userId });
      } catch (err) {
        if (freeTrial) return null;
        console.warn("[aimarkets-usage] BYOK key store unavailable", err);
        throw new Error(BYOK_STORE_UNAVAILABLE, { cause: err });
      }
      const key = keys[providerId];
      if (!key) {
        if (freeTrial) return null;
        throw new Error(missingKeyMessage(providerId));
      }
      return {
        apiKey: key.apiKey,
        source: `aimarkets-byok:${providerId}`,
        ...(providerId === BYOK_CUSTOM_PROVIDER_ID && key.baseUrl ? { baseUrl: key.baseUrl } : {}),
        ...(providerId === BYOK_CUSTOM_PROVIDER_ID && key.model ? { modelId: key.model } : {}),
      };
    });

    const flushRun = async (runId: string, ctx: unknown) => {
      const bag = pendingByRun.get(runId);
      if (!bag) return;
      if (bag.timer) clearTimeout(bag.timer);
      pendingByRun.delete(runId);
      const cost = bag.byok
        ? 0
        : computeAimarketsSellCost({
            model: bag.model,
            inputTokens: bag.input,
            outputTokens: bag.output,
            markup,
          });
      await reportUsage({
        apiBaseUrl,
        serviceSecret,
        userId: bag.userId || resolveUserId(cfg, bag.sessionId, ctx),
        inputTokens: bag.input,
        outputTokens: bag.output,
        model: bag.model,
        cost,
        markup,
        byok: bag.byok,
      });
    };

    api.on("before_agent_run", async (event: any, ctx: any) => {
      const ctxObj = asRecord(ctx);
      const sessionId = readString(ctxObj.sessionKey, ctxObj.sessionId);
      if (!isAimarketsSession(sessionId, hostBits(ctx, sessionId))) {
        return;
      }
      const model = readString(ctxObj.modelId, event?.model, event?.modelId, ctxObj.model);
      if (model && isPhhotelModelId(model)) {
        return {
          outcome: "block" as const,
          reason: "phhotel_model_on_aimarkets",
          category: "policy",
          message: PHHOTEL_MODEL_BLOCK,
        };
      }
      const ref = splitModelRef(readString(ctxObj.modelProviderId, event?.provider), model);
      if (!ref.provider) {
        return { outcome: "pass" as const };
      }
      const freeTrial = isOpenRouterFreeModel(ref.provider, ref.modelId);
      if (!BYOK_PROVIDER_IDS.has(ref.provider)) {
        return {
          outcome: "block" as const,
          reason: "platform_model_on_aimarkets",
          category: "policy",
          message: PLATFORM_MODEL_BLOCK,
        };
      }
      if (freeTrial) {
        return { outcome: "pass" as const };
      }
      const userId = sessionOwnerId(sessionId);
      if (!userId) {
        return {
          outcome: "block" as const,
          reason: "missing_user_id",
          category: "policy",
          message: "Sign in to AI Markets so OpenClaw can load your API keys (market-{userId}).",
        };
      }
      try {
        let keys = await getUserKeys({ apiBaseUrl, serviceSecret, userId });
        if (!keys[ref.provider]) {
          // The buyer may have just saved a key; skip the cache once.
          keys = await getUserKeys({ apiBaseUrl, serviceSecret, userId, fresh: true });
        }
        if (!keys[ref.provider]) {
          return {
            outcome: "block" as const,
            reason: "byok_key_missing",
            category: "policy",
            message: missingKeyMessage(ref.provider),
            metadata: { provider: ref.provider },
          };
        }
      } catch (err) {
        console.warn("[aimarkets-usage] BYOK key store unavailable", err);
        return {
          outcome: "block" as const,
          reason: "byok_store_unavailable",
          category: "policy",
          message: BYOK_STORE_UNAVAILABLE,
        };
      }
      return { outcome: "pass" as const };
    });

    api.on("llm_output", async (event: any, ctx: any) => {
      const runId = readString(event?.runId) || `anon-${Date.now()}`;
      const sessionId = readString(
        asRecord(ctx).sessionKey,
        event?.sessionId,
        asRecord(ctx).sessionId,
      );
      if (!isAimarketsSession(sessionId, hostBits(ctx, sessionId))) return;

      const tokens = readUsageTokens(event?.usage ?? event?.response?.usage);
      const model = readString(event?.model, event?.modelId, asRecord(ctx).model) || "unknown";
      const provider = readString(event?.provider, asRecord(ctx).modelProviderId).toLowerCase();
      const userId = resolveUserId(cfg, sessionId, ctx);
      const owner = sessionOwnerId(sessionId);
      const byok = Boolean(owner && provider && peekUserKeys(owner)?.[provider]);
      let bag = pendingByRun.get(runId);
      if (!bag) {
        bag = {
          input: 0,
          output: 0,
          model,
          sessionId,
          userId,
          calls: 0,
          byok,
        };
        pendingByRun.set(runId, bag);
      }
      bag.input += tokens.input;
      bag.output += tokens.output;
      bag.calls += 1;
      bag.model = model || bag.model;
      bag.userId = userId || bag.userId;
      bag.byok = bag.byok || byok;
      if (bag.timer) clearTimeout(bag.timer);
      bag.timer = setTimeout(() => {
        void flushRun(runId, ctx);
      }, FLUSH_FALLBACK_MS);
    });

    api.on("agent_end", async (event: any, ctx: any) => {
      const runId = readString(event?.runId) || "";
      if (!runId) return;
      await flushRun(runId, ctx);
    });
  },
});
