import { describe, expect, it } from "vitest";
import { nextZoneAfter, orderAvailableZones, selectNextAvailableZone } from "../src/bot/booking/ZoneSelector.ts";

describe("zonePriority", () => {
  it("returns next zone after current zone", () => {
    expect(nextZoneAfter("B2", ["B2", "B1", "A2"])).toEqual({ zone: "B1", cycled: false });
  });

  it("starts from first zone when current zone is unknown", () => {
    expect(nextZoneAfter(undefined, ["B2", "B1", "A2"])).toEqual({ zone: "B2", cycled: false });
  });

  it("skips already tried zones", () => {
    expect(nextZoneAfter("B2", ["B2", "B1", "A2"], new Set(["B1"]))).toEqual({ zone: "A2", cycled: false });
  });

  it("wraps to first zone when no later zone remains", () => {
    expect(nextZoneAfter("A2", ["B2", "B1", "A2"])).toEqual({ zone: "B2", cycled: false });
  });

  it("keeps cycling after all zones have been tried and flags the new cycle", () => {
    expect(nextZoneAfter("A2", ["B2", "B1", "A2"], new Set(["B2", "B1", "A2"]))).toEqual({ zone: "B2", cycled: true });
  });

  it("does not pick a zone when priority list is empty", () => {
    expect(nextZoneAfter(undefined, [])).toEqual({ cycled: false });
  });

  it("orders available popup zones like v1 priority matching", () => {
    expect(orderAvailableZones([
      { code: "A1", count: 9 },
      { code: "B2", count: 4 },
      { code: "B1", count: 0 },
      { code: "C1", count: 6 },
    ], ["B", "A"], new Set())).toEqual([
      { code: "B2", count: 4 },
      { code: "A1", count: 9 },
      { code: "C1", count: 6 },
    ]);
  });

  it("skips popup zones already tried", () => {
    expect(orderAvailableZones([
      { code: "B2", count: 4 },
      { code: "A1", count: 9 },
    ], ["B", "A"], new Set(["B2"]))).toEqual([
      { code: "A1", count: 9 },
    ]);
  });

  it("starts priority cycle over when all available zones were tried", () => {
    expect(selectNextAvailableZone([
      { code: "B2", count: 4 },
      { code: "A1", count: 9 },
    ], ["B", "A"], new Set(["B2", "A1"]))).toEqual({
      code: "B2",
      resetTriedZones: true,
    });
  });

  it("does not pick a zone when popup says all zones have zero seats", () => {
    expect(selectNextAvailableZone([
      { code: "B2", count: 0 },
      { code: "A1", count: 0 },
    ], ["B", "A"], new Set())).toEqual({
      resetTriedZones: false,
    });
  });
});
