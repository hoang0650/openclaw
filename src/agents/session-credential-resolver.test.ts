import { afterEach, describe, expect, it } from "vitest";
import {
  hasSessionCredentialResolvers,
  registerSessionCredentialResolver,
  resolveSessionCredential,
} from "./session-credential-resolver.js";

describe("session credential resolver registry", () => {
  const cleanups: Array<() => void> = [];

  afterEach(() => {
    while (cleanups.length > 0) {
      cleanups.pop()?.();
    }
  });

  it("returns null without a session key or resolvers", async () => {
    expect(
      await resolveSessionCredential({ sessionKey: " ", provider: "openai", modelId: "gpt-5.6" }),
    ).toBeNull();
  });

  it("returns the first non-empty override and trims the key", async () => {
    cleanups.push(registerSessionCredentialResolver("empty", () => ({ apiKey: "  " })));
    cleanups.push(
      registerSessionCredentialResolver("byok", ({ provider }) =>
        provider === "openai" ? { apiKey: " sk-user ", source: "test" } : null,
      ),
    );
    expect(hasSessionCredentialResolvers()).toBe(true);
    await expect(
      resolveSessionCredential({ sessionKey: "market-x", provider: "openai", modelId: "gpt-5.6" }),
    ).resolves.toEqual({ apiKey: "sk-user", source: "test" });
    await expect(
      resolveSessionCredential({ sessionKey: "market-x", provider: "google", modelId: "g" }),
    ).resolves.toBeNull();
  });

  it("propagates resolver failures instead of falling back", async () => {
    cleanups.push(
      registerSessionCredentialResolver("broken", () => {
        throw new Error("key store down");
      }),
    );
    await expect(
      resolveSessionCredential({ sessionKey: "market-x", provider: "openai", modelId: "gpt-5.6" }),
    ).rejects.toThrow("key store down");
  });

  it("unregister only removes its own resolver", () => {
    const first = registerSessionCredentialResolver("same", () => null);
    const second = registerSessionCredentialResolver("same", () => null);
    first();
    expect(hasSessionCredentialResolvers()).toBe(true);
    second();
    expect(hasSessionCredentialResolvers()).toBe(false);
  });
});
