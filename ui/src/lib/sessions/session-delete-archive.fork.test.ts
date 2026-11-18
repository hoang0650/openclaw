// Fork: write-scoped operators delete via archive-then-delete.
import { describe, expect, it, vi } from "vitest";
import type { GatewayBrowserClient } from "../../api/gateway.ts";
import { createSessionCapability } from "./index.ts";
import { createGatewayHarness, sessionsResult } from "./session-capability.test-support.ts";

function harness(scopes: string[], onArchive?: () => Promise<void>) {
  const request = vi.fn(async (method: string, _params?: unknown) => {
    if (method === "sessions.patch") {
      await onArchive?.();
      return { ok: true };
    }
    if (method === "sessions.delete") {
      return { ok: true, deleted: true };
    }
    if (method === "sessions.list") {
      return sessionsResult([], 1);
    }
    return {};
  });
  const client = { request } as unknown as GatewayBrowserClient;
  const { gateway, publish } = createGatewayHarness(client);
  const withAuth = {
    ...gateway,
    get snapshot() {
      return { ...gateway.snapshot, hello: { auth: { role: "operator", scopes } } as never };
    },
  };
  return {
    request,
    publish,
    sessions: createSessionCapability(
      withAuth as never,
      {
        state: { selectedId: "main" },
        subscribe: () => () => undefined,
      } as never,
    ),
  };
}

describe("fork archive-then-delete", () => {
  it("archives first when operator.admin is missing", async () => {
    const { request, sessions } = harness(["operator.read", "operator.write"]);
    await sessions.delete("agent:main:chat-1");
    const methods = request.mock.calls.map(([method]) => method);
    expect(methods.indexOf("sessions.patch")).toBeGreaterThanOrEqual(0);
    expect(methods.indexOf("sessions.patch")).toBeLessThan(methods.indexOf("sessions.delete"));
    const del = request.mock.calls.find(([method]) => method === "sessions.delete");
    expect(del?.[1]).toMatchObject({ archivedOnly: true });
    sessions.dispose();
  });

  it("skips the archive patch when alreadyArchived", async () => {
    const { request, sessions } = harness(["operator.read", "operator.write"]);
    await sessions.delete("agent:main:chat-2", { alreadyArchived: true });
    expect(request.mock.calls.map(([method]) => method)).not.toContain("sessions.patch");
    sessions.dispose();
  });

  it("keeps a plain delete for admins", async () => {
    const { request, sessions } = harness(["operator.admin"]);
    await sessions.delete("agent:main:chat-3");
    expect(request.mock.calls.map(([method]) => method)).not.toContain("sessions.patch");
    sessions.dispose();
  });

  it("does not delete after the connection changes during archive", async () => {
    const archive = Promise.withResolvers<void>();
    const { request, publish, sessions } = harness(["operator.write"], () => archive.promise);
    const deletion = sessions.delete("agent:main:chat-4");
    await vi.waitFor(() =>
      expect(request).toHaveBeenCalledWith("sessions.patch", expect.anything(), expect.anything()),
    );
    publish(false);
    const rejected = expect(deletion).rejects.toThrow("replaced Gateway connection");
    archive.resolve();
    await rejected;
    expect(request.mock.calls.map(([method]) => method)).not.toContain("sessions.delete");
    sessions.dispose();
  });
});
