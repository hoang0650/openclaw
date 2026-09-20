/**
 * Shared audience helpers for OpenClaw plugins (no DOM).
 * Keep in sync with ui/src/app/audience-models.ts PHHOTEL_MODEL_IDS.
 */

export const PHHOTEL_MODEL_IDS = new Set([
  "deepseek-ai/DeepSeek-V4-Flash",
  "Qwen/Qwen3.6-35B-A3B",
  "MiniMaxAI/MiniMax-M2.5",
]);

/** Provider COGS USD per 1M tokens (Featherless / known paid). Free OpenRouter = 0. */
export const AIMARKETS_PROVIDER_RATES: Record<string, { input: number; output: number }> = {
  "deepseek-ai/DeepSeek-V4-Flash": { input: 0.14, output: 0.28 },
  "Qwen/Qwen3.6-35B-A3B": { input: 0.2, output: 0.4 },
  "MiniMaxAI/MiniMax-M2.5": { input: 0.295, output: 1.2 },
  default: { input: 0.15, output: 0.6 },
};

/** AI Markets sell price = provider COGS × (1 + markup). Default +25%. */
export const AIMARKETS_PROVIDER_MARKUP = 0.25;

export function isAimarketsSession(sessionId: string, ctxHostBits: string[] = []): boolean {
  const raw = String(sessionId || "").trim();
  if (/(?:^|[:/_-])market[:_-][a-f0-9]{24}/i.test(raw)) return true;
  return ctxHostBits.some((value) => /\.openclaw\.aimarkets\.vn/i.test(value));
}

export function isPhhotelModelId(model: string): boolean {
  const raw = String(model || "").trim();
  if (!raw) return false;
  const bare = raw.includes("/") ? raw.replace(/^(featherless|openrouter)\//i, "") : raw;
  return PHHOTEL_MODEL_IDS.has(raw) || PHHOTEL_MODEL_IDS.has(bare);
}

export function normalizeModelId(model: string): string {
  return String(model || "")
    .trim()
    .replace(/^(featherless|openrouter)\//i, "");
}

export function resolveProviderRate(model: string): { input: number; output: number } {
  const bare = normalizeModelId(model);
  return AIMARKETS_PROVIDER_RATES[bare] || AIMARKETS_PROVIDER_RATES.default;
}

/** Sell cost in USD for token usage (provider COGS + markup%). Free models stay 0. */
export function computeAimarketsSellCost(params: {
  model: string;
  inputTokens: number;
  outputTokens: number;
  markup?: number;
}): number {
  const markup = Number.isFinite(params.markup) ? Number(params.markup) : AIMARKETS_PROVIDER_MARKUP;
  const rate = resolveProviderRate(params.model);
  // Free OpenRouter (:free) — no provider COGS; platform still may charge 0.
  if (/:free$/i.test(normalizeModelId(params.model)) || /openrouter\/free/i.test(params.model)) {
    return 0;
  }
  const cogs =
    (Math.max(0, params.inputTokens) / 1_000_000) * rate.input +
    (Math.max(0, params.outputTokens) / 1_000_000) * rate.output;
  return Math.round(cogs * (1 + markup) * 1e6) / 1e6;
}
