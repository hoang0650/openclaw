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

/** Buyer or hotel id from the public host. Port and a proxy chain are ignored. */
export function tenantIdFromHost(host: string | undefined): string | undefined {
  const hostname = String(host ?? "")
    .split(",")[0]
    ?.trim()
    .toLowerCase()
    .replace(/:\d+$/, "");
  if (!hostname) {
    return undefined;
  }
  const phhotel = /^([a-f0-9]{24})\.phhotel\.vn$/i.exec(hostname);
  if (phhotel?.[1]) {
    return phhotel[1].toLowerCase();
  }
  const aimarkets = /^([a-f0-9]{24})\.openclaw\.aimarkets\.vn$/i.exec(hostname);
  return aimarkets?.[1]?.toLowerCase();
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
