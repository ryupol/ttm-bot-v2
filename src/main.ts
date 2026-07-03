import React from "react";
import { parseArgs } from "node:util";
import { Worker } from "node:worker_threads";
import { render } from "ink";
import { selectBotAccounts } from "./config/accounts.ts";
import { loadAppConfig } from "./config/load.ts";
import { createBotWorkerHandle, type BotWorkerHandle } from "./ipc/channel.ts";
import { parseCommand, resolveTargets } from "./ipc/commands.ts";
import { createStartupAutoLogin } from "./ipc/startupAutoLogin.ts";
import type { BotCommand, BotEvent, BotSnapshot, LogEntry, MainCommand } from "./ipc/types.ts";
import { App } from "./tui/App.tsx";

const options = parseCli();
const { config, accounts, accountRouting } = loadAppConfig({
  concertPath: options.concert,
  settingsPath: options.settings,
  accountsPath: options.accounts,
});

const selectedAccounts = selectBotAccounts(accounts, {
  botCount: options.bots,
  reuseFirstAccount: accountRouting.reuseFirstAccount,
});
if (selectedAccounts.length === 0) throw new Error("No accounts configured");
const runId = formatRunId(new Date());

const snapshots = new Map<number, BotSnapshot>();
const logs: LogEntry[] = [];
const workers = new Map<number, BotWorkerHandle>();
let selectedLogBot: number | undefined;
let ink: ReturnType<typeof render> | undefined;
const startupAutoLogin = createStartupAutoLogin({
  enabled: config.settings.auto_login_on_startup,
  send: (botId, command) => {
    workers.get(botId)?.send(command);
    addLog(botId, "command: login (startup)");
  },
});

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
      runId,
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
    startupAutoLogin.onBotEvent(event);
  }

  if (event.type === "log") addLog(event.botId, event.message);
  if (event.type === "alert") addLog(event.botId, event.message);
  if (event.type === "error") {
    addLog(event.botId, `ERROR: ${event.message}`);
  }

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
  if (command.type === "log") {
    selectedLogBot = command.target === "all" ? undefined : command.target;
    addLog(undefined, command.target === "all" ? "log filter: all" : `log filter: bot ${command.target}`);
    return;
  }

  const botCommand = toBotCommand(command);
  const botIds = resolveTargets(command.target, [...workers.keys()]);
  for (const botId of botIds) {
    workers.get(botId)?.send(botCommand);
    addLog(botId, `command: ${command.type}`);
  }
}

function toBotCommand(command: Exclude<MainCommand, { type: "log" }>): BotCommand {
  if (command.type === "login") return { type: "login" };
  if (command.type === "check") return { type: "check" };
  if (command.type === "go") return { type: "go" };
  if (command.type === "stop") return { type: "stop" };
  if (command.type === "reset") return { type: "reset" };
  return assertNever(command);
}

function assertNever(value: never): never {
  throw new Error(`Unhandled command: ${JSON.stringify(value)}`);
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
    onCommand: handleCommand,
  });

  if (ink) {
    ink.rerender(element);
    return ink;
  }
  return render(element);
}

async function shutdown(): Promise<void> {
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
    ? new URL("./bot/runtime/worker.ts", import.meta.url)
    : new URL("./bot/runtime/worker.js", import.meta.url);
}

function sourceIsTypescript(): boolean {
  return import.meta.url.endsWith(".ts");
}

function formatRunId(date: Date): string {
  const tzOffset = -date.getTimezoneOffset();
  const sign = tzOffset >= 0 ? "+" : "-";
  const hh = String(Math.floor(Math.abs(tzOffset) / 60)).padStart(2, "0");
  const mm = String(Math.abs(tzOffset) % 60).padStart(2, "0");
  const local =
    `${date.getFullYear()}${pad2(date.getMonth() + 1)}${pad2(date.getDate())}` +
    `T${pad2(date.getHours())}${pad2(date.getMinutes())}${pad2(date.getSeconds())}`;
  return `${local}${sign}${hh}${mm}`;
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}
