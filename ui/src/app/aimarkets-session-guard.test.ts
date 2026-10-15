/* @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  FOREIGN_SESSION_MESSAGE,
  correctForeignSessionLocation,
  guardAimarketsSessionOnStartup,
  isForeignAimarketsSessionError,
  marketSessionOwner,
  recoverFromForeignAimarketsSession,
  resolveAimarketsCurrentUserId,
  scrubForeignPersistedSessions,
} from "./aimarkets-session-guard.ts";

const ME = "6a69f0cdd7faa829b87a852e";
const OTHER = "6a69f224e6032a3f00de977f";
const HOST = `${ME}.openclaw.aimarkets.vn`;
const SETTINGS = "openclaw.control.settings.v1:wss://x";

afterEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

describe("aimarkets session guard", () => {
  it("reads the owner of market session keys", () => {
    expect(marketSessionOwner(`market-${OTHER}`)).toBe(OTHER);
    expect(marketSessionOwner(`agent:main:market-${ME}`)).toBe(ME);
    expect(marketSessionOwner("main")).toBeNull();
  });

  it("uses the subdomain buyer as the current identity", () => {
    expect(resolveAimarketsCurrentUserId(HOST)).toBe(ME);
    expect(resolveAimarketsCurrentUserId("openclaw.phhotel.vn")).toBeNull();
  });

  it("rewrites a stale ~key route and session params to the buyer's own session", () => {
    const fixed = correctForeignSessionLocation(
      { pathname: `/chat/main/~key/market-${OTHER}`, search: `?session=market-${OTHER}`, hash: "" },
      ME,
    );
    expect(fixed).toEqual({
      pathname: `/chat/main/~key/market-${ME}`,
      search: `?session=market-${ME}`,
      hash: "",
    });
    expect(
      correctForeignSessionLocation(
        { pathname: `/chat/main/~key/market-${ME}`, search: "", hash: "" },
        ME,
      ),
    ).toBeNull();
    expect(
      correctForeignSessionLocation(
        { pathname: "/chat/main/~key/release-deadbeef", search: "", hash: "" },
        ME,
      ),
    ).toBeNull();
  });

  it("scrubs persisted selections that belong to another buyer", () => {
    localStorage.setItem(
      SETTINGS,
      JSON.stringify({
        sessionKey: `market-${OTHER}`,
        lastActiveSessionKey: `market-${OTHER}`,
        theme: "dark",
      }),
    );
    localStorage.setItem("openclaw.aimarkets.context.v1", JSON.stringify({ userId: OTHER }));
    expect(scrubForeignPersistedSessions(ME)).toBe(true);
    expect(JSON.parse(localStorage.getItem(SETTINGS)!)).toEqual({
      sessionKey: `market-${ME}`,
      lastActiveSessionKey: `market-${ME}`,
      theme: "dark",
    });
    expect(JSON.parse(localStorage.getItem("openclaw.aimarkets.context.v1")!)).toEqual({
      userId: ME,
    });
    expect(scrubForeignPersistedSessions(ME)).toBe(false);
  });

  it("startup guard fixes the URL from the bug report", () => {
    localStorage.setItem(SETTINGS, JSON.stringify({ sessionKey: `market-${OTHER}` }));
    const fixed = guardAimarketsSessionOnStartup(
      { pathname: `/chat/main/~key/market-${OTHER}`, search: "", hash: "" },
      HOST,
    );
    expect(fixed?.pathname).toBe(`/chat/main/~key/market-${ME}`);
    expect(JSON.parse(localStorage.getItem(SETTINGS)!).sessionKey).toBe(`market-${ME}`);
    expect(
      guardAimarketsSessionOnStartup({ pathname: `/chat/main/~key/market-${OTHER}` }, "localhost"),
    ).toBeNull();
  });

  it("recovers once from the gateway's cross-account error, then backs off", () => {
    expect(isForeignAimarketsSessionError(`GatewayRequestError: ${FOREIGN_SESSION_MESSAGE}`)).toBe(
      true,
    );
    const replace = vi.fn();
    const win = {
      location: {
        hostname: HOST,
        pathname: `/chat/main/~key/market-${OTHER}`,
        search: "",
        hash: "",
        replace,
      },
    } as unknown as Window;
    expect(recoverFromForeignAimarketsSession(win, 1_000_000)).toBe(true);
    expect(replace).toHaveBeenCalledWith(`/chat/main/~key/market-${ME}`);
    expect(recoverFromForeignAimarketsSession(win, 1_005_000)).toBe(false);
    expect(replace).toHaveBeenCalledOnce();
  });
});
