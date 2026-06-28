import type { BotCommand, BotEvent } from "./types.ts";

export type StartupAutoLogin = {
  onBotEvent: (event: BotEvent) => void;
};

export function createStartupAutoLogin(options: {
  enabled: boolean;
  send: (botId: number, command: BotCommand) => void;
}): StartupAutoLogin {
  const sentBotIds = new Set<number>();

  return {
    onBotEvent(event) {
      if (!options.enabled || event.type !== "state" || event.state !== "IDLE") return;
      if (sentBotIds.has(event.botId)) return;
      sentBotIds.add(event.botId);
      options.send(event.botId, { type: "login" });
    },
  };
}
