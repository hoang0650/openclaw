import { afterEach, describe, expect, it, vi } from "vitest";
import { getUserKeys, isOpenRouterFreeModel, peekUserKeys } from "./byok.ts";

const API = "https://api.example.test";
const UID = "0123456789abcdef01234567";

describe("aimarkets BYOK helpers", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("detects OpenRouter free models only", () => {
    expect(isOpenRouterFreeModel("openrouter", "openai/gpt-oss-20b:free")).toBe(true);
    expect(isOpenRouterFreeModel("openrouter", "openrouter/free")).toBe(true);
    expect(isOpenRouterFreeModel("openrouter", "openrouter/auto")).toBe(false);
    expect(isOpenRouterFreeModel("openai", "gpt-oss-20b:free")).toBe(false);
  });

  it("fetches, sanitizes and caches buyer keys", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({
        success: true,
        keys: {
          openai: { apiKey: " sk-user " },
          "byok-custom": { apiKey: "k", baseUrl: "https://llm.example.com/v1", model: "m" },
          unknown: { apiKey: "ignored" },
          anthropic: { apiKey: "" },
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const keys = await getUserKeys({ apiBaseUrl: API, serviceSecret: "s", userId: UID });
    expect(keys).toEqual({
      openai: { apiKey: "sk-user" },
      "byok-custom": { apiKey: "k", baseUrl: "https://llm.example.com/v1", model: "m" },
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${API}/v1/openclaw/byok/resolve?user_id=${UID}`);
    expect((init.headers as Record<string, string>)["X-Service-Secret"]).toBe("s");

    await getUserKeys({ apiBaseUrl: API, serviceSecret: "s", userId: UID });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(peekUserKeys(UID)?.openai?.apiKey).toBe("sk-user");

    await getUserKeys({ apiBaseUrl: API, serviceSecret: "s", userId: UID, fresh: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("throws when the key store is unavailable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("nope", { status: 503 })),
    );
    await expect(
      getUserKeys({
        apiBaseUrl: API,
        serviceSecret: "s",
        userId: "fedcba9876543210fedcba98",
        fresh: true,
      }),
    ).rejects.toThrow(/HTTP 503/);
  });
});
