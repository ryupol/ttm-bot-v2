import { describe, expect, it } from "vitest";
import { nextAcquisitionReloadDelayMs, botReloadOffsetMs } from "../src/bot/queueSchedule.ts";

describe("queueSchedule", () => {
  it("uses pre-sale acquisition reload cadence", () => {
    const delay = nextAcquisitionReloadDelayMs(
      new Date("2026-06-28T02:30:00.000Z"),
      "2026-06-28T10:00:00+07:00",
      1,
    );

    expect(delay).toBeGreaterThanOrEqual(10_000);
    expect(delay).toBeLessThanOrEqual(15_000);
  });

  it("uses post-sale acquisition reload cadence without deadline", () => {
    const delay = nextAcquisitionReloadDelayMs(
      new Date("2026-06-28T03:30:00.000Z"),
      "2026-06-28T10:00:00+07:00",
      1,
    );

    expect(delay).toBeGreaterThanOrEqual(5_000);
    expect(delay).toBeLessThanOrEqual(10_000);
  });

  it("stagger bots by 150ms", () => {
    expect(botReloadOffsetMs(1)).toBe(0);
    expect(botReloadOffsetMs(2)).toBe(150);
    expect(botReloadOffsetMs(5)).toBe(600);
  });
});
