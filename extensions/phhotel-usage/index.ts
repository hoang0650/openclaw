/**
 * Report OpenClaw LLM token usage to phhotel-api AI quota (channel: openclaw).
 */
import { definePluginEntry, type OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";

type PendingUsage = {
  input: number;
  output: number;
  model: string;
  sessionId: string;
  hotelId: string;
  userId: string;
  timer?: ReturnType<typeof setTimeout>;
};

type PluginConfig = {
  apiBaseUrl?: string;
  serviceSecret?: string;
  hotelId?: string;
  userId?: string;
};

const pendingByRun = new Map<string, PendingUsage>();
const FLUSH_FALLBACK_MS = 45_000;

/** Read process.env without requiring @types/node in isolated IDE checks. */
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

function readString(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      return String(value);
    }
  }
  return "";
}

/** Parse hotel-<id> / phhotel-<id> / nested agent:...:hotel-<id> / __u-<userId>. */
function parseIdsFromSession(sessionId: string): { hotelId: string; userId: string } {
  const raw = String(sessionId || "").trim();
  if (!raw) {
    return { hotelId: "", userId: "" };
  }
  const hotelMatch =
    /(?:^|[:/_-])(?:hotel|phhotel)[:_-]([a-f0-9]{24}|[a-z0-9-]{8,})(?:$|[:/_-])/i.exec(raw) ||
    /^(?:hotel|phhotel)[:_-]([a-f0-9]{24}|[a-z0-9-]{8,})$/i.exec(raw);
  const userMatch = /(?:__u-|user[:_-])([a-f0-9]{24})/i.exec(raw);
  return {
    hotelId: hotelMatch?.[1] || "",
    userId: userMatch?.[1] || "",
  };
}

function resolveHotelId(cfg: PluginConfig, sessionId: string, ctx: unknown): string {
  const ctxObj = asRecord(ctx);
  const fromSession = parseIdsFromSession(sessionId).hotelId;
  const fromCtxSession = parseIdsFromSession(
    readString(ctxObj.sessionKey, ctxObj.sessionId),
  ).hotelId;
  return (
    fromSession ||
    fromCtxSession ||
    readString(cfg.hotelId) ||
    readString(readEnv("PHHOTEL_HOTEL_ID"), readEnv("OPENCLAW_HOTEL_ID")) ||
    readString(ctxObj.hotelId, ctxObj.tenantId) ||
    ""
  );
}

function resolveUserId(cfg: PluginConfig, sessionId: string, ctx: unknown): string {
  const ctxObj = asRecord(ctx);
  const fromSession = parseIdsFromSession(sessionId).userId;
  const fromCtxSession = parseIdsFromSession(
    readString(ctxObj.sessionKey, ctxObj.sessionId),
  ).userId;
  return (
    fromSession ||
    fromCtxSession ||
    readString(cfg.userId) ||
    readString(readEnv("PHHOTEL_USER_ID"), readEnv("OPENCLAW_USER_ID")) ||
    readString(ctxObj.userId) ||
    ""
  );
}

function resolveApiBase(cfg: PluginConfig): string {
  return readString(
    cfg.apiBaseUrl,
    readEnv("PHHOTEL_API_URL"),
    readEnv("NEST_API_URL"),
    readEnv("NEST_BACKEND_URL"),
    "https://api.phhotel.vn",
  ).replace(/\/+$/, "");
}

function resolveServiceSecret(cfg: PluginConfig): string {
  return readString(
    cfg.serviceSecret,
    readEnv("PHHOTEL_SERVICE_SECRET"),
    readEnv("NEST_SERVICE_AUTH_SECRET"),
    readEnv("AI_SERVICE_SHARED_SECRET"),
    readEnv("PYTHON_AI_SHARED_SECRET"),
  );
}

async function reportUsage(params: {
  apiBaseUrl: string;
  serviceSecret: string;
  hotelId: string;
  userId: string;
  inputTokens: number;
  outputTokens: number;
  model: string;
  turns: number;
}): Promise<void> {
  if (!params.apiBaseUrl || !params.serviceSecret || !params.hotelId) {
    console.warn("[phhotel-usage] skip report: missing apiBaseUrl/serviceSecret/hotelId", {
      hasApi: !!params.apiBaseUrl,
      hasSecret: !!params.serviceSecret,
      hotelId: params.hotelId || null,
    });
    return;
  }
  if (params.inputTokens <= 0 && params.outputTokens <= 0) {
    return;
  }

  const url = `${params.apiBaseUrl}/ai-usage/internal/openclaw`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "X-Service-Secret": params.serviceSecret,
      },
      body: JSON.stringify({
        hotelId: params.hotelId,
        userId: params.userId || undefined,
        channel: "openclaw",
        turns: params.turns,
        inputTokens: params.inputTokens,
        outputTokens: params.outputTokens,
        model: params.model || undefined,
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.warn(`[phhotel-usage] report failed HTTP ${res.status}: ${text.slice(0, 300)}`);
      return;
    }
    console.log(
      `[phhotel-usage] reported openclaw usage hotel=${params.hotelId} in=${params.inputTokens} out=${params.outputTokens} model=${params.model}`,
    );
  } catch (err) {
    console.warn("[phhotel-usage] report error:", (err as Error)?.message || err);
  }
}

export default definePluginEntry({
  id: "phhotel-usage",
  name: "PHHotel AI Usage",
  description: "Report OpenClaw LLM token usage to PHHotel AI quota (channel openclaw).",
  register(api: OpenClawPluginApi) {
    const cfg = (api.pluginConfig || {}) as PluginConfig;
    const apiBaseUrl = resolveApiBase(cfg);
    const serviceSecret = resolveServiceSecret(cfg);

    const flushRun = async (runId: string, ctx: unknown) => {
      const bag = pendingByRun.get(runId);
      if (!bag) return;
      if (bag.timer) {
        clearTimeout(bag.timer);
      }
      pendingByRun.delete(runId);
      await reportUsage({
        apiBaseUrl,
        serviceSecret,
        hotelId: bag.hotelId || resolveHotelId(cfg, bag.sessionId, ctx),
        userId: bag.userId || resolveUserId(cfg, bag.sessionId, ctx),
        inputTokens: bag.input,
        outputTokens: bag.output,
        model: bag.model,
        turns: 1,
      });
    };

    api.on("llm_output", async (event: any, ctx: any) => {
      const runId = readString(event?.runId) || `anon-${Date.now()}`;
      const sessionId = readString(
        event?.sessionId,
        asRecord(ctx).sessionKey,
        asRecord(ctx).sessionId,
      );
      const input = Math.max(0, Math.floor(Number(event?.usage?.input) || 0));
      const output = Math.max(0, Math.floor(Number(event?.usage?.output) || 0));
      const model = readString(event?.resolvedRef, event?.model);
      const hotelId = resolveHotelId(cfg, sessionId, ctx);
      const userId = resolveUserId(cfg, sessionId, ctx);

      const current = pendingByRun.get(runId) || {
        input: 0,
        output: 0,
        model: "",
        sessionId: "",
        hotelId: "",
        userId: "",
      };
      current.input += input;
      current.output += output;
      current.model = model || current.model;
      current.sessionId = sessionId || current.sessionId;
      current.hotelId = hotelId || current.hotelId;
      current.userId = userId || current.userId;
      if (current.timer) {
        clearTimeout(current.timer);
      }
      // Fallback nếu agent_end không fire (timeout / abort)
      current.timer = setTimeout(() => {
        void flushRun(runId, ctx);
      }, FLUSH_FALLBACK_MS);
      pendingByRun.set(runId, current);
    });

    api.on("agent_end", async (event: any, ctx: any) => {
      const runId = readString(event?.runId, asRecord(ctx).runId);
      if (!runId) return;
      await flushRun(runId, ctx);
    });

    api.logger?.info?.(
      `phhotel-usage ready api=${apiBaseUrl || "(missing)"} secret=${serviceSecret ? "set" : "missing"}`,
    );
  },
});
