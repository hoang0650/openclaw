// @vitest-environment node
// Fork (PHHotel / AI Markets) startup handoff behavior.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeUiSettings, setTestLocation } from "../test-helpers/settings-node.ts";
import {
  parseAimarketsUserId,
  parsePhhotelTenantHotelId,
  resolveAimarketsScopedSessionKey,
  resolveApplicationStartupSettings,
  resolvePhhotelScopedSessionKey,
} from "./startup-settings.ts";

const HEX24 = "0123456789abcdef01234567";

describe("fork startup settings", () => {
  beforeEach(() => {
    vi.stubGlobal("window", {});
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("applies PHHotel auto-login hash with gatewayToken/password/autoConnect", () => {
    setTestLocation({ protocol: "https:", host: "control.example", pathname: "/" });
    const startup = resolveApplicationStartupSettings(makeUiSettings("wss://old.example"), {
      pathname: "/",
      search: "",
      hash: "#gatewayUrl=wss%3A%2F%2Fhotel.phhotel.vn&token=gtok-123&gatewayToken=gtok-123&password=gtok-123&autoConnect=true&session=main",
    });
    expect(startup.autoConnect).toBe(true);
    expect(startup.settings.gatewayUrl).toBe("wss://hotel.phhotel.vn");
    expect(startup.settings.token).toBe("gtok-123");
    expect(startup.password).toBe("gtok-123");
    expect(startup.pendingGatewayUrl).toBeNull();
    expect(startup.location.hash).not.toContain("token=");
    expect(startup.location.hash).not.toContain("password=");
    expect(startup.location.hash).not.toContain("autoConnect");
  });

  it("forces hotel session from page hostname {tenantId}.phhotel.vn", () => {
    setTestLocation({ protocol: "https:", host: `${HEX24}.phhotel.vn`, pathname: "/chat" });
    const startup = resolveApplicationStartupSettings(makeUiSettings("wss://old.example"), {
      pathname: "/chat",
      search: "?session=agent%3Amain%3Amain",
      hash: "",
    });
    expect(startup.settings.sessionKey).toBe(`hotel-${HEX24}`);
    expect(startup.location.search).toContain(`session=hotel-${HEX24}`);
    expect(startup.location.hash).toContain(`hotelId=${HEX24}`);
  });

  it("forces market session on {userId}.openclaw.aimarkets.vn, never a hotel session", () => {
    setTestLocation({
      protocol: "https:",
      host: `${HEX24}.openclaw.aimarkets.vn`,
      pathname: "/chat",
    });
    expect(parsePhhotelTenantHotelId(`${HEX24}.openclaw.aimarkets.vn`)).toBeUndefined();
    const startup = resolveApplicationStartupSettings(makeUiSettings("wss://old.example"), {
      pathname: "/chat",
      search: "?session=agent%3Amain%3Amain",
      hash: "",
    });
    expect(startup.settings.sessionKey).toBe(`market-${HEX24}`);
    expect(startup.location.hash).toContain(`userId=${HEX24}`);
    expect(startup.location.hash).not.toContain("hotelId=");
  });

  it("accepts base64 #config= payload aliases", () => {
    setTestLocation({ protocol: "https:", host: "control.example", pathname: "/" });
    const payload = btoa(
      JSON.stringify({
        gatewayUrl: "wss://cfg.example",
        gatewayToken: "cfg-token",
        password: "cfg-token",
        autoConnect: true,
      }),
    );
    const startup = resolveApplicationStartupSettings(makeUiSettings("wss://old.example"), {
      pathname: "/",
      search: "",
      hash: `#config=${payload}`,
    });
    expect(startup.autoConnect).toBe(true);
    expect(startup.settings.gatewayUrl).toBe("wss://cfg.example");
    expect(startup.settings.token).toBe("cfg-token");
    expect(startup.password).toBe("cfg-token");
    expect(startup.location.hash).not.toContain("config=");
  });

  it("scopes session keys by tenant host", () => {
    expect(resolvePhhotelScopedSessionKey("main", `${HEX24}.phhotel.vn`)).toBe(`hotel-${HEX24}`);
    expect(resolvePhhotelScopedSessionKey(`hotel-${HEX24}`, `${HEX24}.phhotel.vn`)).toBeUndefined();
    expect(resolvePhhotelScopedSessionKey("main", "example.com")).toBeUndefined();
    expect(parseAimarketsUserId(`https://${HEX24}.openclaw.aimarkets.vn/`)).toBe(HEX24);
    expect(
      resolveAimarketsScopedSessionKey("agent:main:main", `${HEX24}.openclaw.aimarkets.vn`),
    ).toBe(`market-${HEX24}`);
  });
});
