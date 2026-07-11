import type { Page } from "playwright";
import type { BotEvent } from "../../ipc/types.ts";
import type { Notifier } from "../observability/Notifier.ts";
import type { ForensicCallbacks } from "../observability/ForensicReporter.ts";
import { createManualAlertDeduper } from "./ManualAlertDeduper.ts";
import { waitForManualInterventionToClear } from "./ManualRecovery.ts";
import { errorMessage } from "../../utils/errors.ts";

export type ManualInterventionServiceOptions = {
  botId: number;
  notifier: Notifier;
  emit: (event: BotEvent) => void;
  getPage: () => Page | undefined;
  shouldStop: () => boolean;
  resume: () => Promise<void>;
  forensics: ForensicCallbacks;
};

export class ManualInterventionService {
  private readonly alertDeduper = createManualAlertDeduper({ cooldownMs: 10_000 });
  private readonly options: ManualInterventionServiceOptions;

  constructor(options: ManualInterventionServiceOptions) {
    this.options = options;
  }

  async emit(reason: string, captureLabel = "manual-intervention-appears", detail?: string, userMessage?: string): Promise<void> {
    if (this.options.shouldStop()) return;
    const page = this.options.getPage();
    if (page && !this.shouldEmitAlert(reason, page.url())) return;

    const statusDetail = userMessage ?? (detail ? `${reason}: ${detail}` : reason);
    const message = `Bot ${this.options.botId}: manual intervention (${statusDetail}) - solve in browser`;
    await this.options.forensics.captureDecision(captureLabel);
    this.options.forensics.event("manual-intervention", "appeared", { reason, detail, userMessage });
    this.options.emit({ type: "state", botId: this.options.botId, state: "MANUAL_INTERVENTION", detail: statusDetail });
    this.options.emit({ type: "alert", botId: this.options.botId, kind: "manual_intervention", message });
    await this.notifyBestEffort(message);
  }

  async waitForClearThenResume(page: Page): Promise<void> {
    const result = await waitForManualInterventionToClear(page, {
      shouldStop: this.options.shouldStop,
      onCleared: async () => {
        await this.options.forensics.captureDecision("manual-intervention-clears");
        this.options.forensics.event("manual-intervention", "cleared");
        this.options.emit({ type: "log", botId: this.options.botId, message: "manual intervention cleared" });
      },
    });
    if (result === "cleared" && !this.options.shouldStop()) await this.options.resume();
  }

  shouldEmitAlert(reason: string, url: string): boolean {
    return this.alertDeduper.shouldEmit(reason, url);
  }

  private async notifyBestEffort(message: string): Promise<void> {
    try {
      await this.options.notifier.send(message);
    } catch (error) {
      this.options.emit({ type: "log", botId: this.options.botId, message: `telegram failed: ${errorMessage(error)}` });
    }
  }
}
