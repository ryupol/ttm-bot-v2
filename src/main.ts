import React from "react";
import { parseArgs } from "node:util";
import { Worker } from "node:worker_threads";
import { render } from "ink";
import { loadAppConfig } from "./config/load.js";
import { createBotWorkerHandle, type BotWorkerHandle } from "./ipc/channel.js";
import { nextStartTime, parseCommand, resolveTargets } from "./ipc/commands.js";
import type { BotCommand, BotEvent, BotSnapshot, LogEntry, MainCommand } from "./ipc/types.js";
import { App } from "./tui/App.js";

const options = parseCli();
const { config, accounts } = loadAppConfig({
  concertPath: options.concert,
  settingsPath: options.settings,
  accountsPath: options.accounts,
});

const botCount = options.bots ?? Math.min(accounts.length, 5);
const selectedAccounts = accounts.slice(0, botCount);
if (selectedAccounts.length === 0) throw new Error("No accounts configured");

const snapshots = new Map<number, BotSnapshot>();
const logs: LogEntry[] = [];
const workers = new Map<number, BotWorkerHandle>();
let selectedLogBot: number | undefined;
let scheduledStart: string | undefined;
let scheduledTimer: NodeJS.Timeout | undefined;
let ink: ReturnType<typeof render> | undefined;

for (const account of selectedAccounts) {
  snapshots.set(account.id, { id: account.id, state: "IDLE" });
}

ink = renderApp();

for (const account of selectedAccounts) {
  const worker = new Worker(resolveWorkerUrl(), {
    workerData: {
      botId: account.id,
      totalBots: selectedAccounts.length,
      config,
      account,
    },
    execArgv: sourceIsTypescript() ? ["--import", "tsx"] : undefined,
  });
  const handle = createBotWorkerHandle(account.id, worker, onBotEvent);
  workers.set(account.id, handle);
}

process.on("SIGINT", () => {
  void shutdown();
});

function onBotEvent(event: BotEvent): void {
  if (event.type === "state") {
    snapshots.set(event.botId, {
      id: event.botId,
      state: event.state,
      detail: event.detail,
      lastEventAt: new Date().toISOString(),
    });
    addLog(event.botId, `state -> ${event.state}${event.detail ? ` (${event.detail})` : ""}`);
  }

  if (event.type === "log") addLog(event.botId, event.message);
  if (event.type === "alert") addLog(event.botId, event.message);
  if (event.type === "error") addLog(event.botId, `ERROR: ${event.message}`);

  renderApp();
}

function handleCommand(input: string): void {
  try {
    const command = parseCommand(input);
    dispatch(command);
  } catch (error) {
    addLog(undefined, error instanceof Error ? error.message : String(error));
  }
  renderApp();
}

function dispatch(command: MainCommand): void {
  if (command.type === "set-time") {
    const start = nextStartTime(new Date(), command.time);
    scheduledStart = start.toLocaleString();
    if (scheduledTimer) clearTimeout(scheduledTimer);
    scheduledTimer = setTimeout(() => {
      addLog(undefined, "scheduled start fired");
      broadcast({ type: "go", scheduledFor: scheduledStart });
      scheduledStart = undefined;
      renderApp();
    }, Math.max(0, start.getTime() - Date.now()));
    addLog(undefined, `scheduled go all at ${scheduledStart}`);
    return;
  }

  if (command.type === "log") {
    selectedLogBot = command.target === "all" ? undefined : command.target;
    addLog(undefined, command.target === "all" ? "log filter: all" : `log filter: bot ${command.target}`);
    return;
  }

  const botCommand = toBotCommand(command);
  for (const botId of resolveTargets(command.target, [...workers.keys()])) {
    workers.get(botId)?.send(botCommand);
    addLog(botId, `command: ${command.type}`);
  }
}

function toBotCommand(command: Exclude<MainCommand, { type: "set-time" | "log" }>): BotCommand {
  if (command.type === "prepare") return { type: "prepare" };
  if (command.type === "go") return { type: "go" };
  if (command.type === "stop") return { type: "stop" };
  if (command.type === "reset") return { type: "reset" };
  return { type: "assign" };
}

function broadcast(command: BotCommand): void {
  for (const worker of workers.values()) worker.send(command);
}

function addLog(botId: number | undefined, message: string): void {
  logs.push({
    at: new Date().toLocaleTimeString(),
    botId,
    message,
  });
  if (logs.length > 500) logs.splice(0, logs.length - 500);
}

function renderApp(): ReturnType<typeof render> {
  const element = React.createElement(App, {
    bots: [...snapshots.values()].sort((a, b) => a.id - b.id),
    logs,
    selectedLogBot,
    scheduledStart,
    onCommand: handleCommand,
  });

  if (ink) {
    ink.rerender(element);
    return ink;
  }
  return render(element);
}

async function shutdown(): Promise<void> {
  if (scheduledTimer) clearTimeout(scheduledTimer);
  addLog(undefined, "shutting down workers");
  renderApp();
  await Promise.all([...workers.values()].map((worker) => worker.stop().catch(() => undefined)));
  ink?.unmount();
  process.exit(0);
}

function parseCli(): { bots?: number; concert?: string; settings?: string; accounts?: string } {
  const parsed = parseArgs({
    options: {
      bots: { type: "string" },
      concert: { type: "string" },
      settings: { type: "string" },
      accounts: { type: "string" },
    },
    allowPositionals: false,
  });

  return {
    bots: parsed.values.bots ? Number(parsed.values.bots) : undefined,
    concert: parsed.values.concert,
    settings: parsed.values.settings,
    accounts: parsed.values.accounts,
  };
}

function resolveWorkerUrl(): URL {
  return sourceIsTypescript()
    ? new URL("./bot/worker.ts", import.meta.url)
    : new URL("./bot/worker.js", import.meta.url);
}

function sourceIsTypescript(): boolean {
  return import.meta.url.endsWith(".ts");
}
