import type { AppConfig, ResolvedAccount } from "../config/schema.ts";

export type BotState =
  | "IDLE"
  | "ARMED"
  | "READY"
  | "WATCHING_QUEUE_OPEN"
  | "IN_QUEUE"
  | "MANUAL_INTERVENTION"
  | "AWAITING_USER"
  | "BOOKING"
  | "DONE"
  | "ERROR"
  | "STOPPED";

export type CommandTarget = "all" | number;

export type BotCommand =
  | { type: "login" }
  | { type: "check" }
  | { type: "go"; scheduledFor?: string }
  | { type: "stop" }
  | { type: "shutdown" }
  | { type: "reset" };

export type MainCommand =
  | { type: "login"; target: CommandTarget }
  | { type: "check"; target: CommandTarget }
  | { type: "go"; target: CommandTarget }
  | { type: "stop"; target: CommandTarget }
  | { type: "reset"; target: CommandTarget }
  | { type: "log"; target: CommandTarget };

export type BotAlertKind =
  | "captcha_detected"
  | "manual_intervention"
  | "queue_exit"
  | "no_seats"
  | "seats_selected";

export type BotEvent =
  | { type: "state"; botId: number; state: BotState; detail?: string }
  | { type: "log"; botId: number; message: string }
  | { type: "alert"; botId: number; kind: BotAlertKind; message: string; seats?: PickedSeat[]; zone?: string }
  | { type: "error"; botId: number; message: string; stack?: string };

export type WorkerInit = {
  botId: number;
  totalBots: number;
  config: AppConfig;
  account: ResolvedAccount;
  runId?: string;
};

export type PickedSeat = {
  id: string;
  row: string | number;
  col: number;
};

export type BotSnapshot = {
  id: number;
  state: BotState;
  detail?: string;
  lastEventAt?: string;
};

export type LogEntry = {
  at: string;
  botId?: number;
  message: string;
};
