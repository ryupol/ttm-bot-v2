import type { Page } from "playwright";
import type { BotEvent } from "../../ipc/types.ts";
import { detectManualInterventionOnPage } from "../manual/ManualIntervention.ts";
import { classifyCurrentPage, type PageKind } from "./PageClassifier.ts";

export type PageStatusReporterOptions = {
  botId: number;
  emit: (event: BotEvent) => void;
  getPage: () => Page;
  shouldStop: () => boolean;
  emitRecentAccessBlock: () => boolean;
  emitDone: (kind: Extract<PageKind, "payment" | "enroll">) => void;
};

export class PageStatusReporter {
  private readonly options: PageStatusReporterOptions;

  constructor(options: PageStatusReporterOptions) {
    this.options = options;
  }

  async check(): Promise<void> {
    if (this.options.shouldStop()) {
      this.options.emit({ type: "state", botId: this.options.botId, state: "STOPPED", detail: "Stopped by user" });
      return;
    }
    const p = this.options.getPage();
    if (this.options.emitRecentAccessBlock()) return;
    const kind = await classifyCurrentPage(p);
    const manual = await detectManualInterventionOnPage(p);
    const detail = `Current page: ${kind}${manual.present ? `; manual=${manual.reason}` : ""}`;
    this.options.emit({ type: "log", botId: this.options.botId, message: `check: ${detail}; url=${p.url()}` });

    if (manual.present) {
      this.options.emit({ type: "state", botId: this.options.botId, state: "MANUAL_INTERVENTION", detail: manual.userMessage });
      return;
    }
    if (kind === "queue") {
      this.options.emit({ type: "state", botId: this.options.botId, state: "IN_QUEUE", detail: "Current page: queue" });
      return;
    }
    if (kind === "zones" || kind === "fixed") {
      this.options.emit({ type: "state", botId: this.options.botId, state: "BOOKING", detail: `Current page: ${kind}` });
      return;
    }
    if (kind === "payment" || kind === "enroll") {
      this.options.emitDone(kind);
      return;
    }
    if (kind === "event") {
      this.options.emit({ type: "state", botId: this.options.botId, state: "READY", detail: "Current page: event" });
      return;
    }
    this.options.emit({ type: "state", botId: this.options.botId, state: "AWAITING_USER", detail });
  }
}
