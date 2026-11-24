// @vitest-environment node
import { expect, it } from "vitest";
import { resolveChatHistoryMethod } from "./chat-history.ts";

it("uses session-scoped history when opening an AI Markets buyer chat", () => {
  expect(resolveChatHistoryMethod(true, "aaaaaaaaaaaaaaaaaaaaaaaa.openclaw.aimarkets.vn")).toBe(
    "chat.history",
  );
  expect(resolveChatHistoryMethod(true, "localhost")).toBe("chat.startup");
  expect(resolveChatHistoryMethod(false, "localhost")).toBe("chat.history");
});
