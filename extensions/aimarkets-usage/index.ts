/**
 * Bill AI Markets OpenClaw usage to marketplace wallet (provider COGS + 25%).
 * PHHotel sessions are ignored (handled by phhotel-usage).
 */
import { definePluginEntry, type OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";
import {
  computeAimarketsSellCost,
  isAimarketsSession,
  isPhhotelModelId,
  AIMARKETS_PROVIDER_MARKUP,
} from "./audience.ts";

type PendingUsage = {
  input: number;
  output: number;
  model: string;
  sessionId: string;
  userId: string;
  calls: number;
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
  "This model is reserved for PHHotel. Pick an AI Markets OpenRouter/Featherless model (aimarkets-* / openrouter free).";

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

function hostBits(ctx: unknown, sessionId: string): string[] {
  const ctxObj = asRecord(ctx);
  return [
    readString(ctxObj.gatewayUrl, ctxObj.host, ctxObj.hostname, ctxObj.publicUrl, ctxObj.origin),
    sessionId,
  ];
}

async function checkWallet(params: {
  apiBaseUrl: string;
  serviceSecret: string;
  userId: string;
}): Promise<{ allowed: boolean; available?: number; reason?: string }> {
  if (!params.userId || !params.apiBaseUrl) {
    return { allowed: false, reason: "missing_user_or_api" };
  }
  try {
    const url = `${params.apiBaseUrl}/v1/openclaw/usage/check?user_id=${encodeURIComponent(params.userId)}`;
    const res = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        ...(params.serviceSecret ? { "X-Service-Secret": params.serviceSecret } : {}),
      },
    });
    const data = (await res.json().catch(() => ({}))) as {
      allowed?: boolean;
      available?: number;
      message?: string;
    };
    if (!res.ok) {
      return { allowed: false, reason: data.message || `http_${res.status}` };
    }
    return {
      allowed: data.allowed !== false,
      available: data.available,
      reason: data.message,
    };
  } catch (err) {
    console.warn("[aimarkets-usage] wallet check failed", err);
    // Fail open on network blips so Control UI stays usable; charge still runs after.
    return { allowed: true };
  }
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
        cost: params.cost,
        markup: params.markup,
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
  description: "Charge marketplace wallet for OpenClaw LLM usage (provider cost + 25%).",
  register(api: OpenClawPluginApi) {
    const cfg = (api.pluginConfig || {}) as PluginConfig;
    const apiBaseUrl = resolveApiBase(cfg);
    const serviceSecret = resolveServiceSecret(cfg);
    const markup =
      typeof cfg.markup === "number" && Number.isFinite(cfg.markup)
        ? cfg.markup
        : AIMARKETS_PROVIDER_MARKUP;

    const flushRun = async (runId: string, ctx: unknown) => {
      const bag = pendingByRun.get(runId);
      if (!bag) return;
      if (bag.timer) clearTimeout(bag.timer);
      pendingByRun.delete(runId);
      const cost = computeAimarketsSellCost({
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
      });
    };

    api.on("before_agent_run", async (event: any, ctx: any) => {
      const sessionId = readString(asRecord(ctx).sessionKey, asRecord(ctx).sessionId);
      if (!isAimarketsSession(sessionId, hostBits(ctx, sessionId))) {
        return;
      }
      const model = readString(event?.model, event?.modelId, asRecord(ctx).model);
      if (model && isPhhotelModelId(model)) {
        return {
          outcome: "block" as const,
          reason: "phhotel_model_on_aimarkets",
          category: "policy",
          message: PHHOTEL_MODEL_BLOCK,
        };
      }
      const userId = resolveUserId(cfg, sessionId, ctx);
      if (!userId) {
        return {
          outcome: "block" as const,
          reason: "missing_user_id",
          category: "cost_limit",
          message: "Sign in to AI Markets so OpenClaw can bill your wallet (market-{userId}).",
        };
      }
      const check = await checkWallet({ apiBaseUrl, serviceSecret, userId });
      if (!check.allowed) {
        return {
          outcome: "block" as const,
          reason: "insufficient_wallet",
          category: "cost_limit",
          message:
            check.reason ||
            "Insufficient AI Markets wallet balance. Top up at aimarkets.vn then retry.",
          metadata: { available: check.available },
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
      const userId = resolveUserId(cfg, sessionId, ctx);
      let bag = pendingByRun.get(runId);
      if (!bag) {
        bag = {
          input: 0,
          output: 0,
          model,
          sessionId,
          userId,
          calls: 0,
        };
        pendingByRun.set(runId, bag);
      }
      bag.input += tokens.input;
      bag.output += tokens.output;
      bag.calls += 1;
      bag.model = model || bag.model;
      bag.userId = userId || bag.userId;
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
