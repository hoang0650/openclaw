/**
 * OpenClaw serves PHHotel and AI Markets on one gateway.
 * Audience is derived from Control UI hostname / session key.
 * PHHotel models (phhotel-* aliases + Nest sales stack) must not appear on aimarkets.
 */
export type OpenClawAudience = "phhotel" | "aimarkets" | "unknown";

/** Nest / PHHotel OpenClaw stack — hidden on AI Markets. */
export const PHHOTEL_MODEL_IDS = new Set([
  "deepseek-ai/DeepSeek-V4-Flash",
  "Qwen/Qwen3.6-35B-A3B",
  "MiniMaxAI/MiniMax-M2.5",
]);

export function isAimarketsHostname(host?: string | null): boolean {
  const h = String(host || "")
    .trim()
    .toLowerCase()
    .replace(/:\d+$/, "");
  return (
    h === "openclaw.aimarkets.vn" || h.endsWith(".openclaw.aimarkets.vn") || h === "aimarkets.vn"
  );
}

export function isPhhotelHostname(host?: string | null): boolean {
  const h = String(host || "")
    .trim()
    .toLowerCase()
    .replace(/:\d+$/, "");
  return h === "openclaw.phhotel.vn" || h.endsWith(".phhotel.vn");
}

export function resolveOpenClawAudience(opts?: {
  hostname?: string | null;
  sessionKey?: string | null;
  audienceParam?: string | null;
}): OpenClawAudience {
  const param = String(opts?.audienceParam || "")
    .trim()
    .toLowerCase();
  if (param === "aimarkets" || param === "ai-markets" || param === "marketplace") {
    return "aimarkets";
  }
  if (param === "phhotel" || param === "hotel") {
    return "phhotel";
  }
  const session = String(opts?.sessionKey || "");
  if (/(?:^|[:/_-])market[:_-][a-f0-9]{24}/i.test(session)) {
    return "aimarkets";
  }
  if (/(?:^|[:/_-])(?:hotel|phhotel)[:_-]/i.test(session)) {
    return "phhotel";
  }
  if (typeof globalThis !== "undefined" && globalThis.location?.hostname) {
    if (isAimarketsHostname(globalThis.location.hostname)) return "aimarkets";
    if (isPhhotelHostname(globalThis.location.hostname)) return "phhotel";
  }
  if (opts?.hostname) {
    if (isAimarketsHostname(opts.hostname)) return "aimarkets";
    if (isPhhotelHostname(opts.hostname)) return "phhotel";
  }
  return "unknown";
}

export function isPhhotelModelEntry(entry: {
  id?: string;
  alias?: string;
  name?: string;
  provider?: string;
}): boolean {
  const alias = String(entry.alias || "").toLowerCase();
  if (alias.startsWith("phhotel-") || alias.startsWith("hotel-")) return true;
  const id = String(entry.id || "");
  const bare = id.includes("/") ? id.split("/").slice(1).join("/") : id;
  if (PHHOTEL_MODEL_IDS.has(id) || PHHOTEL_MODEL_IDS.has(bare)) return true;
  const name = String(entry.name || "").toLowerCase();
  return name.includes("phhotel") || name.includes("(default / sales");
}

export function isAimarketsModelEntry(entry: {
  id?: string;
  alias?: string;
  name?: string;
}): boolean {
  const alias = String(entry.alias || "").toLowerCase();
  if (alias.startsWith("aimarkets-") || alias.startsWith("market-")) return true;
  // OpenRouter free catalog is aimarkets-facing when not tagged phhotel.
  if (isPhhotelModelEntry(entry)) return false;
  const id = String(entry.id || "").toLowerCase();
  return id.startsWith("openrouter/") || id.includes(":free") || alias.includes("or-");
}

/**
 * Filter gateway models.list for the current product surface.
 * - aimarkets: hide PHHotel Nest stack; prefer aimarkets-* / openrouter free
 * - phhotel: hide aimarkets-* aliases
 */
export function filterModelsForAudience<T extends { id?: string; alias?: string; name?: string }>(
  models: T[],
  audience: OpenClawAudience = resolveOpenClawAudience(),
): T[] {
  if (!Array.isArray(models) || models.length === 0) return models;
  if (audience === "aimarkets") {
    const withoutHotel = models.filter((m) => !isPhhotelModelEntry(m));
    const aimarketsOnly = withoutHotel.filter((m) => isAimarketsModelEntry(m));
    return aimarketsOnly.length > 0 ? aimarketsOnly : withoutHotel;
  }
  if (audience === "phhotel") {
    return models.filter((m) => {
      const alias = String(m.alias || "").toLowerCase();
      return !alias.startsWith("aimarkets-") && !alias.startsWith("market-");
    });
  }
  return models;
}
