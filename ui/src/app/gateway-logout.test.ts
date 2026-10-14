import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { storeAimarketsTicket, syncAimarketsTicketCookie } from "./aimarkets-ticket.ts";
import {
  clearGatewayBrowserState,
  resetGatewayStateOnAimarketsIdentitySwitch,
  resolveAimarketsLaunchUserId,
} from "./gateway-logout.ts";

const USER_A = "0123456789abcdef01234567";
const USER_B = "fedcba9876543210fedcba98";
const HOST = "6a69f0cdd7faa829b87a852e.openclaw.aimarkets.vn";

function ticketFor(uid: string): string {
  const payload = btoa(JSON.stringify({ uid, exp: Date.now() + 600_000 }))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return `${payload}.sig`;
}

function seedAccount(uid: string) {
  localStorage.setItem("openclaw.aimarkets.context.v1", JSON.stringify({ userId: uid }));
  localStorage.setItem("openclaw.control.settings.v1:wss://x", "{}");
  localStorage.setItem("openclaw-device-identity-v1", "{}");
  localStorage.setItem("openclaw.device.auth.v1:wss://x", "{}");
  sessionStorage.setItem("openclaw.control.token.v1:wss://x", "secret");
  localStorage.setItem("openclaw.i18n.locale", "vi");
  storeAimarketsTicket(ticketFor(uid));
}

function cookieHasTicket(): boolean {
  return document.cookie
    .split(";")
    .some((part) => part.trim().startsWith("aimt=") && part.trim().length > 5);
}

describe("gateway logout / AI Markets identity switch", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    document.cookie = "aimt=; Path=/; Max-Age=0";
  });
  afterEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it("clears gateway token, device identity, session and ticket state but keeps unrelated prefs", () => {
    seedAccount(USER_A);
    expect(cookieHasTicket()).toBe(true);
    clearGatewayBrowserState();
    expect(localStorage.getItem("openclaw.aimarkets.context.v1")).toBeNull();
    expect(localStorage.getItem("openclaw.control.settings.v1:wss://x")).toBeNull();
    expect(localStorage.getItem("openclaw-device-identity-v1")).toBeNull();
    expect(localStorage.getItem("openclaw.device.auth.v1:wss://x")).toBeNull();
    expect(localStorage.getItem("openclaw.aimarkets.ticket.v1")).toBeNull();
    expect(sessionStorage.getItem("openclaw.control.token.v1:wss://x")).toBeNull();
    expect(localStorage.getItem("openclaw.i18n.locale")).toBe("vi");
    expect(cookieHasTicket()).toBe(false);
  });

  it("resolves the launch buyer from the ticket first, then userId", () => {
    expect(resolveAimarketsLaunchUserId({ hash: `#userId=${USER_A}` })).toBe(USER_A);
    expect(
      resolveAimarketsLaunchUserId({ hash: `#userId=${USER_A}&marketTicket=${ticketFor(USER_B)}` }),
    ).toBe(USER_B);
    expect(resolveAimarketsLaunchUserId({ hash: "#userId=nope" })).toBeNull();
  });

  it("resets stored state when the link belongs to another buyer", () => {
    seedAccount(USER_A);
    expect(
      resetGatewayStateOnAimarketsIdentitySwitch(
        { search: `?session=market-${USER_B}`, hash: `#userId=${USER_B}` },
        HOST,
      ),
    ).toBe(true);
    expect(localStorage.getItem("openclaw-device-identity-v1")).toBeNull();
    expect(sessionStorage.getItem("openclaw.control.token.v1:wss://x")).toBeNull();
    expect(cookieHasTicket()).toBe(false);
  });

  it("keeps stored state for the same buyer, non-aimarkets hosts and links without a buyer", () => {
    seedAccount(USER_A);
    expect(resetGatewayStateOnAimarketsIdentitySwitch({ hash: `#userId=${USER_A}` }, HOST)).toBe(
      false,
    );
    expect(
      resetGatewayStateOnAimarketsIdentitySwitch({ hash: `#userId=${USER_B}` }, "x.phhotel.vn"),
    ).toBe(false);
    expect(resetGatewayStateOnAimarketsIdentitySwitch({ hash: "" }, HOST)).toBe(false);
    expect(localStorage.getItem("openclaw-device-identity-v1")).toBe("{}");
  });

  it("drops a stale ticket cookie that belongs to another buyer", () => {
    seedAccount(USER_A);
    syncAimarketsTicketCookie(USER_B);
    expect(cookieHasTicket()).toBe(false);
    expect(localStorage.getItem("openclaw.aimarkets.ticket.v1")).toBeNull();
  });
});
