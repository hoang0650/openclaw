import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  checkAimarketsSessionAccess,
  collectMarketSessionUserIds,
  isAimarketsHost,
  isAimarketsTicketEnforced,
  resolveAimarketsGatewayToken,
  resolveAimarketsUserIdFromUpgrade,
  verifyAimarketsTicket,
} from "./aimarkets-ticket.js";

const SECRET = "test-ticket-secret";
const UID = "0123456789abcdef01234567";
const OTHER = "fedcba9876543210fedcba98";
const ENV_KEYS = [
  "OPENCLAW_MARKET_TICKET_SECRET",
  "AIMARKETS_SERVICE_SECRET",
  "NEST_SERVICE_AUTH_SECRET",
  "PYTHON_AI_SHARED_SECRET",
  "OPENCLAW_AIMARKETS_TICKET_ENFORCE",
  "OPENCLAW_AIMARKETS_HOST_SUFFIX",
] as const;

function issue(uid: string, exp: number, secret = SECRET): string {
  const payload = Buffer.from(JSON.stringify({ uid, exp }), "utf8").toString("base64url");
  const sig = createHmac("sha256", secret).update(`aimt.v1.${payload}`, "utf8").digest("base64url");
  return `${payload}.${sig}`;
}

describe("aimarkets ticket", () => {
  const saved: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};

  beforeEach(() => {
    for (const key of ENV_KEYS) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
    process.env.OPENCLAW_MARKET_TICKET_SECRET = SECRET;
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = saved[key];
      }
    }
  });

  it("accepts a valid ticket and rejects forged or expired ones", () => {
    expect(verifyAimarketsTicket(issue(UID, Date.now() + 60_000))).toBe(UID);
    expect(verifyAimarketsTicket(issue(UID, Date.now() + 60_000, "other-secret"))).toBeNull();
    expect(verifyAimarketsTicket(issue(UID, Date.now() - 1))).toBeNull();
    expect(verifyAimarketsTicket(`${issue(UID, Date.now() + 60_000)}.extra`)).toBeNull();
    expect(verifyAimarketsTicket("")).toBeNull();
  });

  it("reads the ticket from the upgrade cookie", () => {
    const ticket = issue(UID, Date.now() + 60_000);
    expect(
      resolveAimarketsUserIdFromUpgrade({
        headers: { cookie: `theme=dark; aimt=${encodeURIComponent(ticket)}` },
      }),
    ).toBe(UID);
    expect(resolveAimarketsUserIdFromUpgrade({ headers: {} })).toBeUndefined();
  });

  it("only enforces when the dedicated secret or flag is set", () => {
    expect(isAimarketsTicketEnforced()).toBe(true);
    delete process.env.OPENCLAW_MARKET_TICKET_SECRET;
    process.env.NEST_SERVICE_AUTH_SECRET = SECRET;
    expect(isAimarketsTicketEnforced()).toBe(false);
    process.env.OPENCLAW_AIMARKETS_TICKET_ENFORCE = "1";
    expect(isAimarketsTicketEnforced()).toBe(true);
    process.env.OPENCLAW_AIMARKETS_TICKET_ENFORCE = "0";
    expect(isAimarketsTicketEnforced()).toBe(false);
  });

  it("collects market session owners from nested params", () => {
    const ids = collectMarketSessionUserIds({
      sessionKey: `agent:main:market-${UID}`,
      nested: [{ key: `market_${OTHER.toUpperCase()}` }],
      unrelated: "hotel-0123456789abcdef01234567",
    });
    expect([...ids].toSorted()).toEqual([UID, OTHER].toSorted());
  });

  it("blocks access to sessions owned by another buyer", () => {
    const own = { sessionKey: `market-${UID}` };
    expect(checkAimarketsSessionAccess({ requestParams: own, clientUserId: UID })).toBeNull();
    expect(checkAimarketsSessionAccess({ requestParams: own, clientUserId: OTHER })).toMatch(
      /another account/,
    );
    expect(checkAimarketsSessionAccess({ requestParams: own, clientUserId: undefined })).toMatch(
      /launch ticket/,
    );
    expect(
      checkAimarketsSessionAccess({ requestParams: { key: "main" }, clientUserId: undefined }),
    ).toBeNull();
  });

  it("derives the AI Markets gateway token only from both AI Markets secrets", () => {
    expect(resolveAimarketsGatewayToken()).toBe("");
    process.env.AIMARKETS_SERVICE_SECRET = "service-secret"; // pragma: allowlist secret
    process.env.OPENCLAW_MARKET_TICKET_SECRET = "ticket-secret"; // pragma: allowlist secret
    // Same vector as ai-marketplace-api test/openclaw-ticket.test.js.
    expect(resolveAimarketsGatewayToken()).toBe("d2acf1f3372abe6942578a088ea811b39e1f14f85dabf74b");
    delete process.env.OPENCLAW_MARKET_TICKET_SECRET;
    expect(resolveAimarketsGatewayToken()).toBe("");
  });

  it("recognises AI Markets hosts", () => {
    expect(isAimarketsHost(`${UID}.openclaw.aimarkets.vn`)).toBe(true);
    expect(isAimarketsHost("OpenClaw.AIMarkets.vn:443")).toBe(true);
    expect(isAimarketsHost("hotel1.phhotel.vn")).toBe(false);
    expect(isAimarketsHost("evil-openclaw.aimarkets.vn")).toBe(false);
    expect(isAimarketsHost(undefined)).toBe(false);
    process.env.OPENCLAW_AIMARKETS_HOST_SUFFIX = "claw.example";
    expect(isAimarketsHost("u.claw.example")).toBe(true);
  });
});
