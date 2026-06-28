import { describe, expect, it } from "vitest";
import { parseCommand, resolveTargets } from "../src/ipc/commands.ts";

describe("commands", () => {
  it("parses target commands", () => {
    expect(parseCommand("login all")).toEqual({ type: "login", target: "all" });
    expect(parseCommand("go all")).toEqual({ type: "go", target: "all" });
    expect(parseCommand("stop 4")).toEqual({ type: "stop", target: 4 });
  });

  it("parses check command", () => {
    expect(parseCommand("check all")).toEqual({ type: "check", target: "all" });
    expect(parseCommand("check 2")).toEqual({ type: "check", target: 2 });
  });

  it("rejects unknown commands", () => {
    expect(() => parseCommand("launch all")).toThrow("Unknown command");
    expect(() => parseCommand("arm all")).toThrow("Unknown command");
    expect(() => parseCommand("set-time 10:00:00")).toThrow("Unknown command");
  });

  it("resolves all or specific targets", () => {
    expect(resolveTargets("all", [1, 2, 3])).toEqual([1, 2, 3]);
    expect(resolveTargets(2, [1, 2, 3])).toEqual([2]);
  });

});
