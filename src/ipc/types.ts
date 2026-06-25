import type { AppConfig, ResolvedAccount } from "../config/schema.js";

export type BotState =
  | "IDLE"
  | "READY"
  | "IN_QUEUE"
  | "AWAITING_USER"
  | "BOOKING"
  | "DONE"
  | "ERROR"
  | "STOPPED";

export type CommandTarget = "all" | number;

export type BotCommand =
  | { type: "prepare" }
  | { type: "go"; scheduledFor?: string }
  | { type: "stop" }
  | { type: "reset" }
  | { type: "assign" };

export type MainCommand =
  | { type: "prepare"; target: CommandTarget }
  | { type: "go"; target: CommandTarget }
  | { type: "stop"; target: CommandTarget }
  | { type: "reset"; target: CommandTarget }
  | { type: "assign"; target: CommandTarget }
  | { type: "log"; target: CommandTarget }
  | { type: "set-time"; time: string };

export type BotAlertKind =
  | "captcha_detected"
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
