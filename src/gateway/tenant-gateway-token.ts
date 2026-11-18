// Per-tenant Control UI token. Same construction as PHGroup-AI
// `_generate_tenant_secret`: HMAC-SHA256(master, tenantId) as unpadded base64url.
// `{tenantId}.phhotel.vn` and `{userId}.openclaw.aimarkets.vn` each get their own token.
import { createHmac } from "node:crypto";

const TENANT_ID_RE = /^[a-f0-9]{24}$/;

function readEnv(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  return typeof value === "string" ? value.trim() : "";
}

/** Same secret order as PHGroup-AI, including its unset-env fallback. */
export function tenantGatewayMasterSecret(env: NodeJS.ProcessEnv = process.env): string {
  return (
    readEnv(env, "PYTHON_AI_SHARED_SECRET") ||
    readEnv(env, "NEST_SERVICE_AUTH_SECRET") ||
    readEnv(env, "OPENCLAW_GATEWAY_TOKEN_SEED") ||
    "phhotel_openclaw_secret"
  );
}

function tenantIdFromHostname(hostname: string): string | undefined {
  const phhotel = /^([a-f0-9]{24})\.phhotel\.vn$/i.exec(hostname);
  if (phhotel?.[1]) {
    return phhotel[1].toLowerCase();
  }
  const aimarkets = /^([a-f0-9]{24})\.openclaw\.aimarkets\.vn$/i.exec(hostname);
  return aimarkets?.[1]?.toLowerCase();
}

/**
 * Buyer or hotel id from the public host. Port is ignored. A proxy chain is
 * scanned so an internal first hop does not hide `{id}.openclaw.aimarkets.vn`.
 */
export function tenantIdFromHost(host: string | undefined): string | undefined {
  for (const label of String(host ?? "").split(",")) {
    const hostname = label.trim().toLowerCase().replace(/:\d+$/, "");
    const tenantId = hostname ? tenantIdFromHostname(hostname) : undefined;
    if (tenantId) {
      return tenantId;
    }
  }
  return undefined;
}

/** Public tenant hostname from a Host or X-Forwarded-Host chain, if any. */
export function tenantHostnameFromHeader(host: string | undefined): string | undefined {
  for (const label of String(host ?? "").split(",")) {
    const hostname = label.trim().toLowerCase().replace(/:\d+$/, "");
    if (hostname && tenantIdFromHostname(hostname)) {
      return hostname;
    }
  }
  return undefined;
}

/**
 * Control UI opened on its own tenant host. The browser Origin matches the
 * public host, so a missing or stale pasted gateway token must not block it.
 */
export function allowsTenantSameOriginControlUi(params: {
  isControlUi: boolean;
  role: string;
  requestHost?: string;
  requestOrigin?: string;
}): boolean {
  if (!params.isControlUi || params.role !== "operator") {
    return false;
  }
  const hostId = tenantIdFromHost(params.requestHost);
  if (!hostId) {
    return false;
  }
  const origin = String(params.requestOrigin ?? "").trim();
  if (!origin) {
    return false;
  }
  try {
    return tenantIdFromHost(new URL(origin).hostname) === hostId;
  } catch {
    return false;
  }
}

export function tenantGatewayToken(
  tenantId: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const id = String(tenantId ?? "")
    .trim()
    .toLowerCase();
  if (!TENANT_ID_RE.test(id)) {
    return "";
  }
  const secret = tenantGatewayMasterSecret(env);
  if (!secret) {
    return "";
  }
  return createHmac("sha256", secret).update(id, "utf8").digest("base64url");
}
