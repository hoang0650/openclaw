import { afterEach, expect, it, vi } from "vitest";
import { withOpenClawTestState } from "../test-utils/openclaw-test-state.js";
import {
  authorizationClient,
  dispatchAuthorizationRequest,
} from "./server-methods.authorization.test-support.js";
import type { GatewayRequestHandler, GatewayRequestContext } from "./server-methods/types.js";
const buyer = "b".repeat(24);
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
      client: authorizationClient("buyer", ["operator.admin"], { aimarketsUserId: buyer }),
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
