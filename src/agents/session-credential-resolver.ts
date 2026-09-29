/**
 * Per-session provider credential overrides (bring-your-own-key).
 *
 * Plugins register a resolver that may return a user-owned API key for a given
 * session/provider pair. The embedded runner consults the registry before the
 * normal auth-profile chain so one shared gateway can serve many tenants that
 * each pay their own provider bill.
 */

export type SessionCredentialOverride = {
  apiKey: string;
  /** Optional endpoint override (e.g. custom OpenAI-compatible providers). */
  baseUrl?: string;
  /** Optional upstream model id override (custom providers only). */
  modelId?: string;
  /** Short label recorded as the auth source. */
  source?: string;
};

export type SessionCredentialRequest = {
  sessionKey: string;
  provider: string;
  modelId: string;
};

export type SessionCredentialResolver = (
  request: SessionCredentialRequest,
) =>
  | Promise<SessionCredentialOverride | null | undefined>
  | SessionCredentialOverride
  | null
  | undefined;

const REGISTRY_KEY = Symbol.for("openclaw.sessionCredentialResolvers");

type RegistryHost = typeof globalThis & {
  [REGISTRY_KEY]?: Map<string, SessionCredentialResolver>;
};

function registry(): Map<string, SessionCredentialResolver> {
  const host = globalThis as RegistryHost;
  host[REGISTRY_KEY] ??= new Map();
  return host[REGISTRY_KEY];
}

/** Registers (or replaces) a resolver. Returns an unregister function. */
export function registerSessionCredentialResolver(
  id: string,
  resolver: SessionCredentialResolver,
): () => void {
  const map = registry();
  map.set(id, resolver);
  return () => {
    if (map.get(id) === resolver) {
      map.delete(id);
    }
  };
}

export function hasSessionCredentialResolvers(): boolean {
  return registry().size > 0;
}

/**
 * Returns the first non-empty override from registered resolvers. Resolver
 * failures propagate so a run never silently falls back to platform keys when
 * the tenant key store is unreachable.
 */
export async function resolveSessionCredential(
  request: SessionCredentialRequest,
): Promise<SessionCredentialOverride | null> {
  const sessionKey = request.sessionKey?.trim();
  if (!sessionKey) {
    return null;
  }
  for (const resolver of registry().values()) {
    const result = await resolver({ ...request, sessionKey });
    const apiKey = typeof result?.apiKey === "string" ? result.apiKey.trim() : "";
    if (result && apiKey) {
      return { ...result, apiKey };
    }
  }
  return null;
}
