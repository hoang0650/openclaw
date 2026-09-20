import { describe, expect, it } from "vitest";
import {
  filterModelsForAudience,
  isPhhotelModelEntry,
  resolveOpenClawAudience,
} from "./audience-models.ts";

describe("audience-models", () => {
  it("detects aimarkets from hostname", () => {
    expect(
      resolveOpenClawAudience({ hostname: "aaaaaaaaaaaaaaaaaaaaaaaa.openclaw.aimarkets.vn" }),
    ).toBe("aimarkets");
  });

  it("detects phhotel from session", () => {
    expect(resolveOpenClawAudience({ sessionKey: "hotel-aaaaaaaaaaaaaaaaaaaaaaaa" })).toBe(
      "phhotel",
    );
  });

  it("hides PHHotel Nest stack on aimarkets", () => {
    const models = [
      { id: "MiniMaxAI/MiniMax-M2.5", alias: "phhotel-premium", name: "MiniMax PHHotel" },
      { id: "openrouter/free", alias: "aimarkets-main", name: "OpenRouter Free (AI Markets)" },
      { id: "nvidia/nemotron-3-ultra-550b-a55b:free", alias: "aimarkets-or-nemotron-ultra" },
    ];
    const filtered = filterModelsForAudience(models, "aimarkets");
    expect(filtered.map((m) => m.alias)).toEqual(["aimarkets-main", "aimarkets-or-nemotron-ultra"]);
    expect(isPhhotelModelEntry(models[0])).toBe(true);
  });

  it("hides aimarkets aliases on phhotel", () => {
    const models = [
      { id: "deepseek-ai/DeepSeek-V4-Flash", alias: "phhotel-main" },
      { id: "openrouter/free", alias: "aimarkets-main" },
    ];
    const filtered = filterModelsForAudience(models, "phhotel");
    expect(filtered.map((m) => m.alias)).toEqual(["phhotel-main"]);
  });
});
