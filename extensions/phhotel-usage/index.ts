/**
 * Report OpenClaw LLM token usage to phhotel-api AI quota (channel: openclaw).
 *
 * Requires plugins.entries.phhotel-usage.hooks.allowConversationAccess=true
 * so llm_output / agent_end typed hooks are not blocked for non-bundled plugins.
 */
import { definePluginEntry, type OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";

type PendingUsage = {
  input: number;
  output: number;
  model: string;
  sessionId: string;
  hotelId: string;
  userId: string;
  calls: number;
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
      const expanded = expandEnvValue(value.trim());
      if (expanded) {
        return expanded;
      }
      continue;
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      return String(value);
    }
  }
  return "";
}

/** Expand `${ENV_NAME}` placeholders from openclaw.json plugin config. */
function expandEnvValue(value: string): string {
  const trimmed = String(value || "").trim();
  const exact = /^\$\{([A-Z0-9_]+)\}$/.exec(trimmed);
  if (exact) {
    return readEnv(exact[1]);
  }
  return trimmed.replace(/\$\{([A-Z0-9_]+)\}/g, (_m, name: string) => readEnv(name) || "");
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
  // Featherless/OpenClaw: cache-read vẫn tính vào input billing khi prompt_tokens thiếu
  return { input: input > 0 ? input : cacheRead, output };
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
  // Control UI đôi khi chỉ đưa ObjectId 24 hex trong session key
  const bareObjectId = !hotelMatch && /^[a-f0-9]{24}$/i.test(raw) ? raw : null;
  // agent:main:<24hex> (một số tenant dùng ObjectId làm session leaf)
  const leafObjectId =
    !hotelMatch && !bareObjectId
      ? /^agent:[^:]+:([a-f0-9]{24})(?:$|[:/_-])/i.exec(raw)?.[1] || null
      : null;
  const userMatch = /(?:__u-|user[:_-])([a-f0-9]{24})/i.exec(raw);
  return {
    hotelId: hotelMatch?.[1] || bareObjectId || leafObjectId || "",
    userId: userMatch?.[1] || "",
  };
}

/** Hostname dạng {tenantId}.phhotel.vn → hotelId (tenantId === hotelId, không phải userId). */
function parseHotelIdFromHost(value: string): string {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    const host = (
      raw.includes("://") ? new URL(raw).hostname : raw.split("/")[0]?.split(":")[0] || ""
    ).toLowerCase();
    const m = /^([a-f0-9]{24})\.phhotel\.vn$/.exec(host);
    return m?.[1] || "";
  } catch {
    return "";
  }
}

function resolveHotelIdFromEnvHosts(): string {
  const candidates = [
    readEnv("OPENCLAW_GATEWAY_URL"),
    readEnv("OPENCLAW_PUBLIC_URL"),
    readEnv("PUBLIC_GATEWAY_URL"),
    readEnv("GATEWAY_URL"),
    readEnv("OPENCLAW_GATEWAY_HOST"),
    readEnv("PHHOTEL_GATEWAY_HOST"),
    readEnv("RENDER_EXTERNAL_HOSTNAME"),
    readEnv("HOST"),
  ];
  for (const c of candidates) {
    const id = parseHotelIdFromHost(c);
    if (id) return id;
  }
  return "";
}

function resolveHotelId(cfg: PluginConfig, sessionId: string, ctx: unknown): string {
  const ctxObj = asRecord(ctx);
  const fromSession = parseIdsFromSession(sessionId).hotelId;
  const fromCtxSession = parseIdsFromSession(
    readString(ctxObj.sessionKey, ctxObj.sessionId),
  ).hotelId;
  const fromWorkspace = parseIdsFromSession(readString(ctxObj.workspaceDir)).hotelId;
  // tenantId trên domain gateway / wss URL (vd 69d73f54e5302e4f720b66af.phhotel.vn)
  const fromHost = parseHotelIdFromHost(
    readString(
      ctxObj.gatewayUrl,
      ctxObj.host,
      ctxObj.hostname,
      ctxObj.publicUrl,
      ctxObj.origin,
      ctxObj.requestHost,
      ctxObj.forwardedHost,
    ),
  );
  // Quét mọi string trong ctx tìm {24hex}.phhotel.vn (Host từ reverse proxy)
  let fromCtxScan = "";
  for (const [key, value] of Object.entries(ctxObj)) {
    if (fromCtxScan) break;
    if (typeof value === "string") {
      fromCtxScan = parseHotelIdFromHost(value);
    } else if (value && typeof value === "object" && !Array.isArray(value)) {
      const nested = asRecord(value);
      fromCtxScan = parseHotelIdFromHost(
        readString(nested.host, nested.hostname, nested.origin, nested.url, nested.gatewayUrl),
      );
    }
    void key;
  }
  return (
    fromSession ||
    fromCtxSession ||
    fromWorkspace ||
    fromHost ||
    fromCtxScan ||
    readString(cfg.hotelId) ||
    readString(readEnv("PHHOTEL_HOTEL_ID"), readEnv("OPENCLAW_HOTEL_ID")) ||
    readString(ctxObj.hotelId, ctxObj.tenantId) ||
    resolveHotelIdFromEnvHosts() ||
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
  calls: number;
}): Promise<void> {
  if (!params.apiBaseUrl || !params.serviceSecret || (!params.hotelId && !params.userId)) {
    console.warn("[phhotel-usage] skip report: missing apiBaseUrl/serviceSecret/hotelId", {
      hasApi: !!params.apiBaseUrl,
      hasSecret: !!params.serviceSecret,
      hotelId: params.hotelId || null,
      userId: params.userId || null,
      calls: params.calls,
      in: params.inputTokens,
      out: params.outputTokens,
    });
    return;
  }
  // Vẫn báo khi có LLM call (calls>0) dù token = 0 — Nest ghi measured, không ước lượng
  if (params.calls <= 0 && params.inputTokens <= 0 && params.outputTokens <= 0) {
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
        allowEstimate: false,
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.warn(`[phhotel-usage] report failed HTTP ${res.status}: ${text.slice(0, 300)}`);
      return;
    }
    console.log(
      `[phhotel-usage] reported openclaw usage hotel=${params.hotelId} in=${params.inputTokens} out=${params.outputTokens} calls=${params.calls} model=${params.model}`,
    );
  } catch (err) {
    console.warn("[phhotel-usage] report error:", (err as Error)?.message || err);
  }
}

const QUOTA_CACHE_TTL_MS = 8_000;
const quotaCache = new Map<
  string,
  { at: number; allowed: boolean; reason: string; remaining: number | null }
>();

const QUOTA_EXCEEDED_MESSAGE =
  "Đã hết hạn ngạch AI tháng này. Model sẽ không gọi Featherless cho đến khi bạn mua thêm hạn ngạch hoặc nâng cấp gói. Vui lòng vào trang Hạn ngạch AI / Gói giá trên admin.phhotel.vn, hoặc liên hệ quản trị viên PHHotel để được cấp thêm.";

const MISSING_HOTEL_MESSAGE =
  'Không xác định được khách sạn để trừ hạn ngạch AI. Vui lòng mở OpenClaw từ nút "Mở OpenClaw" trong AI Chatbox (session hotel-<id>), không dùng phiên main.';

async function checkHotelQuota(params: {
  apiBaseUrl: string;
  serviceSecret: string;
  hotelId: string;
  userId: string;
}): Promise<{ allowed: boolean; reason: string; remaining: number | null; hotelId?: string }> {
  const cacheKey = `${params.hotelId || "-"}:${params.userId || "-"}`;
  const cached = quotaCache.get(cacheKey);
  if (cached && Date.now() - cached.at < QUOTA_CACHE_TTL_MS) {
    return { allowed: cached.allowed, reason: cached.reason, remaining: cached.remaining };
  }

  if (!params.apiBaseUrl || !params.serviceSecret || (!params.hotelId && !params.userId)) {
    return {
      allowed: false,
      reason: MISSING_HOTEL_MESSAGE,
      remaining: null,
    };
  }

  const url = `${params.apiBaseUrl}/ai-usage/internal/check`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "X-Service-Secret": params.serviceSecret,
      },
      body: JSON.stringify({
        hotelId: params.hotelId || undefined,
        userId: params.userId || undefined,
      }),
    });
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    const data = asRecord(body.data);
    const resolvedHotelId = readString(data.hotelId, body.hotelId, params.hotelId);
    const usage = asRecord(data.usage);
    const remainingRaw = usage.remainingTurns;
    const remaining =
      remainingRaw === null || remainingRaw === undefined
        ? null
        : Math.max(0, Math.floor(Number(remainingRaw) || 0));
    const packageQuota = Math.max(0, Math.floor(Number(usage.packageQuota) || 0));
    const bonusQuota = Math.max(0, Math.floor(Number(usage.bonusQuota) || 0));
    const effectiveQuota = Math.max(
      0,
      Math.floor(Number(data.effectiveQuota ?? usage.monthlyQuota) || packageQuota + bonusQuota),
    );
    const usedTurns = Math.max(0, Math.floor(Number(usage.usedTurns) || 0));
    const hasBonusLeft =
      bonusQuota > 0 && (remaining === null || remaining > 0 || usedTurns < effectiveQuota);

    // Nest explicitly allows (package OR admin-allocated bonus without registered plan)
    if (res.ok && (body.allowed === true || data.allowed === true)) {
      const result = { allowed: true, reason: "", remaining, hotelId: resolvedHotelId };
      quotaCache.set(cacheKey, { at: Date.now(), allowed: true, reason: "", remaining });
      return result;
    }

    // Soft-accept: usage payload shows allocated bonus still available even if shape odd
    if (res.ok && hasBonusLeft && body.allowed !== false && data.allowed !== false) {
      console.log(
        `[phhotel-usage] quota ok via bonus hotel=${resolvedHotelId || params.hotelId} bonus=${bonusQuota} remaining=${remaining ?? "n/a"}`,
      );
      const result = { allowed: true, reason: "", remaining, hotelId: resolvedHotelId };
      quotaCache.set(cacheKey, { at: Date.now(), allowed: true, reason: "", remaining });
      return result;
    }

    if (res.status === 429 || body.allowed === false || data.allowed === false) {
      const reason = readString(body.message, data.reason) || QUOTA_EXCEEDED_MESSAGE;
      console.warn(
        `[phhotel-usage] quota denied hotel=${resolvedHotelId || params.hotelId} pkg=${packageQuota} bonus=${bonusQuota} used=${usedTurns} remaining=${remaining}`,
      );
      const result = {
        allowed: false,
        reason,
        remaining: remaining ?? 0,
        hotelId: resolvedHotelId,
      };
      quotaCache.set(cacheKey, {
        at: Date.now(),
        allowed: false,
        reason,
        remaining: remaining ?? 0,
      });
      return result;
    }

    if (!res.ok) {
      console.warn(
        `[phhotel-usage] quota check HTTP ${res.status}: ${String(body.message || "").slice(0, 200)}`,
      );
      // Fail-closed: không gọi Featherless khi không xác minh được hạn ngạch
      return {
        allowed: false,
        reason:
          "Không kiểm tra được hạn ngạch AI lúc này. Vui lòng thử lại sau hoặc mở trang Hạn ngạch AI trên admin.phhotel.vn.",
        remaining: null,
      };
    }

    const result = { allowed: true, reason: "", remaining, hotelId: resolvedHotelId };
    quotaCache.set(cacheKey, { at: Date.now(), allowed: true, reason: "", remaining });
    return result;
  } catch (err) {
    console.warn("[phhotel-usage] quota check error:", (err as Error)?.message || err);
    return {
      allowed: false,
      reason:
        "Không kết nối được máy chủ hạn ngạch AI. Vui lòng thử lại sau — chưa gọi Featherless.",
      remaining: null,
    };
  }
}

export default definePluginEntry({
  id: "phhotel-usage",
  name: "PHHotel AI Usage",
  description: "Enforce PHHotel AI quota before Featherless calls and report OpenClaw token usage.",
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
      // Invalidate quota cache after a billed turn
      quotaCache.clear();
      await reportUsage({
        apiBaseUrl,
        serviceSecret,
        hotelId: bag.hotelId || resolveHotelId(cfg, bag.sessionId, ctx),
        userId: bag.userId || resolveUserId(cfg, bag.sessionId, ctx),
        inputTokens: bag.input,
        outputTokens: bag.output,
        model: bag.model,
        turns: 1,
        calls: bag.calls,
      });
    };

    // Gate: chặn trước khi agent gọi Featherless nếu hết hạn ngạch (đồng bộ hotelapp AI Usage)
    api.on("before_agent_run", async (_event: any, ctx: any) => {
      const sessionId = readString(asRecord(ctx).sessionKey, asRecord(ctx).sessionId);
      let hotelId = resolveHotelId(cfg, sessionId, ctx);
      const userId = resolveUserId(cfg, sessionId, ctx);

      if (!hotelId && !userId) {
        console.warn("[phhotel-usage] before_agent_run blocked: missing hotelId", {
          sessionId: sessionId || null,
        });
        return {
          outcome: "block" as const,
          reason: "missing_hotel_id",
          category: "cost_limit",
          message: MISSING_HOTEL_MESSAGE,
        };
      }

      const check = await checkHotelQuota({
        apiBaseUrl,
        serviceSecret,
        hotelId,
        userId,
      });

      if (check.hotelId && !hotelId) {
        hotelId = check.hotelId;
      }

      if (!check.allowed) {
        console.warn(
          `[phhotel-usage] quota exceeded hotel=${hotelId || "-"} remaining=${check.remaining}`,
        );
        return {
          outcome: "block" as const,
          reason: hotelId || userId ? "ai_quota_exceeded" : "missing_hotel_id",
          category: "cost_limit",
          message: check.reason || QUOTA_EXCEEDED_MESSAGE,
          metadata: {
            hotelId: hotelId || undefined,
            remainingTurns: check.remaining,
          },
        };
      }

      if (!hotelId) {
        console.warn("[phhotel-usage] before_agent_run blocked: Nest did not resolve hotelId", {
          sessionId: sessionId || null,
          userId: userId || null,
        });
        return {
          outcome: "block" as const,
          reason: "missing_hotel_id",
          category: "cost_limit",
          message: MISSING_HOTEL_MESSAGE,
        };
      }

      console.log(
        `[phhotel-usage] quota ok hotel=${hotelId} remaining=${check.remaining ?? "unlimited"}`,
      );
      return { outcome: "pass" as const };
    });

    api.on("llm_output", async (event: any, ctx: any) => {
      const runId = readString(event?.runId) || `anon-${Date.now()}`;
      const sessionId = readString(
        asRecord(ctx).sessionKey,
        event?.sessionId,
        asRecord(ctx).sessionId,
      );
      const { input, output } = readUsageTokens(event?.usage);
      const model = readString(event?.resolvedRef, event?.model, event?.provider);
      const hotelId = resolveHotelId(cfg, sessionId, ctx);
      const userId = resolveUserId(cfg, sessionId, ctx);
      if (!hotelId) {
        console.warn(
          "[phhotel-usage] llm_output without hotelId — set session=hotel-<id> or PHHOTEL_HOTEL_ID",
          {
            sessionId: sessionId || null,
            runId,
            input,
            output,
          },
        );
      }
      console.log(
        `[phhotel-usage] llm_output run=${runId} hotel=${hotelId || "-"} in=${input} out=${output} model=${model || "-"}`,
      );

      const current = pendingByRun.get(runId) || {
        input: 0,
        output: 0,
        model: "",
        sessionId: "",
        hotelId: "",
        userId: "",
        calls: 0,
      };
      current.input += input;
      current.output += output;
      current.calls += 1;
      current.model = model || current.model;
      current.sessionId = sessionId || current.sessionId;
      current.hotelId = hotelId || current.hotelId;
      current.userId = userId || current.userId;
      if (current.timer) {
        clearTimeout(current.timer);
      }
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
      `phhotel-usage ready api=${apiBaseUrl || "(missing)"} secret=${serviceSecret ? "set" : "missing"} hooks=before_agent_run+llm_output+agent_end`,
    );
  },
});
