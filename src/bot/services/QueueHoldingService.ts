import type { Page } from "playwright";
import type { Concert } from "../../config/schema.ts";
import type { BotEvent } from "../../ipc/types.ts";
import type { Notifier } from "../notifier.ts";
import { holdQueue } from "../pages/queue.ts";
import type { ForensicCallbacks } from "./ForensicReporter.ts";

export type QueueHoldingServiceOptions = {
  botId: number;
  concert: Concert;
  notifier: Notifier;
  emit: (event: BotEvent) => void;
  shouldStop: () => boolean;
  shouldEmitManualAlert: (reason: string, url: string) => boolean;
  handleCurrentPage: () => Promise<void>;
  forensics: ForensicCallbacks;
};

export class QueueHoldingService {
  private readonly options: QueueHoldingServiceOptions;

  constructor(options: QueueHoldingServiceOptions) {
    this.options = options;
  }

  async hold(page: Page): Promise<void> {
    await this.options.forensics.captureDecision("queue-entered");
    this.options.forensics.event("queue", "entered");
    await holdQueue(page, this.options.concert, this.options.botId, this.options.notifier, this.options.emit, {
      shouldStop: this.options.shouldStop,
      shouldEmitManualAlert: this.options.shouldEmitManualAlert,
      forensics: this.options.forensics,
    });
    if (this.options.shouldStop()) return;
    await this.options.handleCurrentPage();
  }
}
