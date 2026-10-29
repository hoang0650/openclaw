import { afterEach, expect, it, vi } from "vitest";
import { withOpenClawTestState } from "../test-utils/openclaw-test-state.js";
import {
  authorizationClient,
  dispatchAuthorizationRequest,
} from "./server-methods.authorization.test-support.js";
import type { GatewayRequestHandler, GatewayRequestContext } from "./server-methods/types.js";
const buyer = "b".repeat(24);
// Real browser handshakes attach this metadata too. It is not internal-only
// authority and must never suppress a verified buyer's method/session boundary.
const browserInternal = {
  authenticatedOperator: true as const,
  authenticatedControlUi: true as const,
  controlUiAdmin: true as const,
  isLocalClient: true as const,
  operatorRoleActor: { kind: "system" as const },
};
afterEach(() => vi.unstubAllEnvs());
it.each([
  ["foreign suffix", { sessionKey: `agent:main:market-${"a".repeat(24)}f`, message: "test" }],
  ["unmarked default", { sessionKey: "agent:main:main", message: "test" }],
  ["omitted default", { message: "test" }],
])("denies %s before agent dispatch", async (_name, params) => {
  vi.stubEnv("OPENCLAW_AIMARKETS_TICKET_ENFORCE", "1");
  await withOpenClawTestState({ scenario: "minimal" }, async () => {
    const handler = vi.fn<GatewayRequestHandler>(({ respond }) => respond(true, { allowed: true }));
    const respond = await dispatchAuthorizationRequest("agent", params, {
      client: authorizationClient("buyer", ["operator.admin"], { aimarketsUserId: buyer, internal: browserInternal }),
      context: {
        getRuntimeConfig: () => ({}),
        logGateway: { warn: vi.fn() },
      } as unknown as GatewayRequestContext,
      extraHandlers: { agent: handler },
    });
    expect(handler).not.toHaveBeenCalled();
    expect(respond).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({ details: { code: "AIMARKETS_SESSION_FORBIDDEN" } }),
    );
  });
});

it.each([
  "config.get",
  "config.patch",
  "config.set",
  "sessions.list",
  "cron.list",
  "cron.add",
  "exec.approval.resolve",
  "agents.update",
  "tools.invoke",
  "unknown.pluginMethod",
])("denies buyer global RPC %s before dispatch even with an owned session", async (method) => {
  await withOpenClawTestState({ scenario: "minimal" }, async () => {
    const handler = vi.fn<GatewayRequestHandler>(({ respond }) => respond(true, { allowed: true }));
    const respond = await dispatchAuthorizationRequest(
      method,
      { sessionKey: `agent:main:market-${buyer}` },
      {
        client: authorizationClient("buyer", ["operator.admin"], { aimarketsUserId: buyer, internal: browserInternal }),
        context: {
          getRuntimeConfig: () => ({}),
          logGateway: { warn: vi.fn() },
        } as unknown as GatewayRequestContext,
        extraHandlers: { [method]: handler },
      },
    );
    expect(handler).not.toHaveBeenCalled();
    expect(respond).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({ details: { code: "AIMARKETS_METHOD_FORBIDDEN" } }),
    );
  });
});
