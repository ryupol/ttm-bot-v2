import type { MainCommand } from "./types.js";

const TARGET_COMMANDS = new Set(["prepare", "go", "stop", "reset", "assign", "log"]);

export function parseCommand(input: string): MainCommand {
  const parts = input.trim().split(/\s+/).filter(Boolean);
  const [verb, arg] = parts;
  if (!verb) throw new Error("Empty command");

  if (verb === "set-time") {
    if (!arg || !/^\d{2}:\d{2}:\d{2}$/.test(arg)) {
      throw new Error("Usage: set-time HH:MM:SS");
    }
    return { type: "set-time", time: arg };
  }

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

export function nextStartTime(today: Date, hhmmss: string): Date {
  const [hh, mm, ss] = hhmmss.split(":").map(Number);
  const d = new Date(today);
  d.setHours(hh, mm, ss, 0);
  if (d.getTime() <= today.getTime()) d.setDate(d.getDate() + 1);
  return d;
}
