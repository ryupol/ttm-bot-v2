import { describe, expect, it } from "vitest";
import { nextStartTime, parseCommand, resolveTargets } from "../src/ipc/commands.js";

describe("commands", () => {
  it("parses target commands", () => {
    expect(parseCommand("prepare all")).toEqual({ type: "prepare", target: "all" });
    expect(parseCommand("stop 4")).toEqual({ type: "stop", target: 4 });
  });

  it("parses set-time command", () => {
    expect(parseCommand("set-time 10:00:00")).toEqual({ type: "set-time", time: "10:00:00" });
  });

  it("rejects unknown commands", () => {
    expect(() => parseCommand("launch all")).toThrow("Unknown command");
  });

  it("resolves all or specific targets", () => {
    expect(resolveTargets("all", [1, 2, 3])).toEqual([1, 2, 3]);
    expect(resolveTargets(2, [1, 2, 3])).toEqual([2]);
  });

  it("schedules next day when time already passed", () => {
    const now = new Date("2026-06-25T10:00:00+07:00");
    expect(nextStartTime(now, "09:59:59").toISOString()).toBe("2026-06-26T02:59:59.000Z");
  });
});
