/**
 * Ponytail coding ruleset for AI Markets sessions. Fetched from the shared
 * Ponytail service (PONYTAIL_URL, see ponytail/deploy/DOKPLOY.md) and
 * prepended to the system prompt, where providers can prompt-cache it.
 */

const REFRESH_MS = 10 * 60_000;
const RETRY_MS = 60_000;
const TIMEOUT_MS = 3_000;
const MODES = new Set(["compact", "lite", "full", "ultra", "off"]);

type PonytailOptions = {
  url: string;
  mode?: string;
  now?: () => number;
};

/** Returns a getter that never throws: the rules text, or "" when unavailable or off. */
export function createPonytailRules(options: PonytailOptions): () => Promise<string> {
  const base = options.url.trim().replace(/\/+$/, "");
  const requested = (options.mode || "").trim().toLowerCase();
  const mode = MODES.has(requested) ? requested : "compact";
  const now = options.now ?? Date.now;
  if (!base || mode === "off") return async () => "";

  let text = "";
  let etag = "";
  let nextRefreshAt = 0;
  let inflight: Promise<void> | null = null;

  const refresh = async () => {
    try {
      const res = await fetch(`${base}/v1/rules?mode=${mode}`, {
        headers: etag ? { "If-None-Match": etag } : {},
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (res.status !== 304) {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = (await res.text()).trim();
        if (body) {
          text = body;
          etag = res.headers.get("etag") || "";
        }
      }
      nextRefreshAt = now() + REFRESH_MS;
    } catch (err) {
      console.warn("[aimarkets-usage] ponytail rules unavailable", err);
      nextRefreshAt = now() + RETRY_MS;
    }
  };

  return async () => {
    if (now() >= nextRefreshAt && !inflight) {
      inflight = refresh().finally(() => {
        inflight = null;
      });
    }
    // Serve the last good copy while revalidating; only the very first fetch waits.
    if (!text && inflight) await inflight;
    return text;
  };
}
