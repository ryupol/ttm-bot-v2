import type { MainCommand } from "./types.ts";

const TARGET_COMMANDS = new Set(["login", "check", "go", "stop", "reset", "log"]);

export function parseCommand(input: string): MainCommand {
  const parts = input.trim().split(/\s+/).filter(Boolean);
  const [verb, arg] = parts;
  if (!verb) throw new Error("Empty command");

  if (!TARGET_COMMANDS.has(verb)) {
    throw new Error(`Unknown command: ${verb}`);
  }

  if (!arg) throw new Error(`Usage: ${verb} all|N`);
  const target = parseTarget(arg);
  return { type: verb as MainCommand["type"], target } as MainCommand;
}

export function parseTarget(value: string): "all" | number {
  if (value === "all") return "all";
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) throw new Error(`Invalid target: ${value}`);
  return n;
}

export function resolveTargets(target: "all" | number, botIds: number[]): number[] {
  if (target === "all") return [...botIds];
  if (!botIds.includes(target)) throw new Error(`Bot ${target} not running`);
  return [target];
}
