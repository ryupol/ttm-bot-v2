import type { Page } from "playwright";
import type { BotEvent } from "../../ipc/types.ts";
import { classifyUnknownManualPage, detectManualInterventionOnPage } from "../manualIntervention.ts";
import { classifyCurrentPage, type PageKind } from "../pages/classifier.ts";

export type PageRouterOptions = {
  botId: number;
  getPage: () => Page;
  shouldStop: () => boolean;
  manualSolveTimeoutSeconds: number;
  emit: (event: BotEvent) => void;
  emitManual: (
    reason: string,
    captureLabel?: string,
    detail?: string,
    userMessage?: string,
  ) => Promise<void>;
  waitForManualClearThenResume: (page: Page) => Promise<void>;
  emitDone: (kind: Extract<PageKind, "payment" | "enroll">) => void;
  queueHolding: {
    hold: (page: Page) => Promise<unknown>;
  };
  booking: {
    bookSeats: (page: Page) => Promise<unknown>;
    recoverFromErrorPage: (page: Page) => Promise<unknown>;
    enterNextZone: (page: Page) => Promise<unknown>;
  };
  verification: {
    submitCitizenId: (page: Page) => Promise<unknown>;
    submitTerms: (page: Page) => Promise<unknown>;
  };
  forensics: {
    captureDecision: (label: string) => Promise<void>;
    event: (area: string, action: string, data?: Record<string, unknown>) => void;
  };
};

export class PageRouter {
  private readonly options: PageRouterOptions;

  constructor(options: PageRouterOptions) {
    this.options = options;
  }

  async handleCurrentPage(options: { waitForFixed?: boolean } = {}): Promise<void> {
    const page = this.options.getPage();
    if (this.options.shouldStop()) return;

    if (options.waitForFixed && !page.url().includes("fixed.php")) {
      this.options.emit({
        type: "state",
        botId: this.options.botId,
        state: "AWAITING_USER",
        detail: "Waiting for fixed.php",
      });
      await page.waitForURL((url) => url.toString().includes("fixed.php"), {
        timeout: this.options.manualSolveTimeoutSeconds * 1000,
      });
    }

    const kind = await classifyCurrentPage(page);
    this.options.emit({ type: "log", botId: this.options.botId, message: `page classified: ${kind}` });

    if (kind === "unknown") {
      const detected = await detectManualInterventionOnPage(page);
      const manual = detected.present
        ? detected
        : classifyUnknownManualPage({ url: page.url(), knownPage: false });
      if (manual.present) {
        await this.options.emitManual(
          manual.reason,
          "manual-intervention-appears",
          manual.detail,
          manual.userMessage,
        );
        await this.options.waitForManualClearThenResume(page);
        return;
      }
    }

    if (kind === "queue") {
      await this.options.queueHolding.hold(page);
      return;
    }

    if (kind === "fixed") {
      await this.options.booking.bookSeats(page);
      return;
    }

    if (kind === "verify") {
      await this.options.verification.submitCitizenId(page);
      return;
    }

    if (kind === "verify_condition") {
      await this.options.verification.submitTerms(page);
      return;
    }

    if (kind === "error") {
      await this.options.booking.recoverFromErrorPage(page);
      return;
    }

    if (kind === "zones") {
      await this.options.booking.enterNextZone(page);
      return;
    }

    if (kind === "payment") {
      this.options.emitDone("payment");
      return;
    }

    if (kind === "enroll") {
      this.options.emitDone("enroll");
      return;
    }

    if (kind === "unknown") {
      await this.options.forensics.captureDecision("manual-intervention-appears");
      this.options.forensics.event("manual-intervention", "awaiting-user", { pageKind: kind });
    }
    this.options.emit({
      type: "state",
      botId: this.options.botId,
      state: "AWAITING_USER",
      detail: `Manual step: ${kind}`,
    });
  }
}
