import type { Worker } from "node:worker_threads";
import type { BotCommand, BotEvent } from "./types.ts";

export type BotWorkerHandle = {
  botId: number;
  worker: Worker;
  send: (command: BotCommand) => void;
  stop: () => Promise<void>;
};

export function createBotWorkerHandle(
  botId: number,
  worker: Worker,
  onEvent: (event: BotEvent) => void,
): BotWorkerHandle {
  worker.on("message", (message: BotEvent) => onEvent(message));
  worker.on("error", (error) => {
    onEvent({ type: "error", botId, message: error.message, stack: error.stack });
  });
  worker.on("exit", (code) => {
    if (code !== 0) onEvent({ type: "error", botId, message: `Worker exited with code ${code}` });
  });

  return {
    botId,
    worker,
    send(command) {
      worker.postMessage(command);
    },
    async stop() {
      worker.postMessage({ type: "shutdown" } satisfies BotCommand);
      await new Promise<void>((resolve) => {
        const timeout = setTimeout(() => {
          void worker.terminate().finally(resolve);
        }, 5000);
        worker.once("exit", () => {
          clearTimeout(timeout);
          resolve();
        });
      });
    },
  };
}
