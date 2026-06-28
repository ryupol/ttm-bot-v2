import { describe, expect, it } from "vitest";
import { computeTile } from "../src/bot/windowLayout.ts";

describe("computeTile", () => {
  it("tiles five bots into stable equal grid cells", () => {
    const settings = { screen_width: 1200, screen_height: 800, gap: 10 };
    expect(computeTile(0, 5, settings)).toEqual({ left: 10, top: 10, width: 386, height: 385 });
    expect(computeTile(4, 5, settings)).toEqual({ left: 406, top: 405, width: 386, height: 385 });
  });
});
