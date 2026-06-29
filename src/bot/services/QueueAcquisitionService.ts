import type { Page } from "playwright";
import type { Concert } from "../../config/schema.ts";
import type { BotEvent } from "../../ipc/types.ts";
import { classifyUnknownManualPage, detectManualInterventionOnPage, transitionManualIntervention } from "../manualIntervention.ts";
import type { TargetRoundState } from "../models/TargetRound.ts";
import { classifyCurrentPage, classifyPage } from "../pages/classifier.ts";
import { nextAcquisitionReloadDelayMs } from "../queueSchedule.ts";
import { resolveTargetRoundOnPage } from "../targetRound.ts";

export type QueueAcquisitionForensics = {
  captureDecision: (label: string) => Promise<void>;
  event: (action: string, result: string, extra?: Record<string, unknown>) => void;
};

export type QueueAcquisitionServiceOptions = {
  botId: number;
  concert: Concert;
  emit: (event: BotEvent) => void;
  shouldStop: () => boolean;
  emitManual: (reason: string, captureLabel: string, detail?: string, userMessage?: string) => Promise<void>;
  waitForManualClearThenResume: (page: Page) => Promise<void>;
  holdQueue: (page: Page) => Promise<void>;
  handleCurrentPage: () => Promise<void>;
  forensics: QueueAcquisitionForensics;
};

export class QueueAcquisitionService {
  private readonly options: QueueAcquisitionServiceOptions;

  constructor(options: QueueAcquisitionServiceOptions) {
    this.options = options;
  }

  async run(p: Page, detail: string): Promise<void> {
    this.options.emit({
      type: "state",
      botId: this.options.botId,
      state: "WATCHING_QUEUE_OPEN",
      detail,
    });
    await p.goto(this.options.concert.event_url, { waitUntil: "domcontentloaded" });
    await this.requireTargetRound(p);
    let nextReloadAt = Date.now() + nextAcquisitionReloadDelayMs(new Date(), this.options.concert.sale_start, this.options.botId);
    let manualVisible = false;
    let targetMissingLogged = false;
    let unknownVisible = false;

    while (!this.options.shouldStop()) {
      const kind = await classifyCurrentPage(p);
      if (kind === "queue") {
        await this.options.holdQueue(p);
        return;
      }
      if (kind === "zones" || kind === "fixed" || kind === "payment" || kind === "enroll") {
        await this.options.handleCurrentPage();
        return;
      }

      const manual = await detectManualInterventionOnPage(p);
      const transition = transitionManualIntervention(manualVisible, manual.present);
      if (transition === "appeared" && manual.present) {
        manualVisible = true;
        await this.options.emitManual(manual.reason, "manual-intervention-appears", manual.detail, manual.userMessage);
      }
      if (manual.present) {
        await sleep(1000);
        continue;
      }
      if (transition === "cleared") {
        manualVisible = false;
        await this.options.forensics.captureDecision("manual-intervention-clears");
        this.options.forensics.event("manual-intervention", "cleared");
        this.options.emit({ type: "state", botId: this.options.botId, state: "WATCHING_QUEUE_OPEN", detail: "Manual step cleared" });
      }

      if (kind === "unknown") {
        const unknownManual = classifyUnknownManualPage({ url: p.url(), knownPage: false });
        if (!unknownVisible && unknownManual.present) {
          unknownVisible = true;
          await this.options.emitManual(unknownManual.reason, "manual-intervention-unknown-page", unknownManual.detail, unknownManual.userMessage);
          await this.options.waitForManualClearThenResume(p);
        }
        return;
      }
      unknownVisible = false;

      const targetRound = this.options.concert.target_round;
      const target = targetRound ? await resolveTargetRoundOnPage(p, targetRound) : undefined;
      if (!target) {
        if (!targetMissingLogged) {
          this.options.emit({ type: "log", botId: this.options.botId, message: "target round not found during watch; retrying" });
          targetMissingLogged = true;
        }
      } else if (target.queueOrBookingCapable) {
        targetMissingLogged = false;
        await this.clickTargetRound(p, target);
        await sleep(2000 + Math.random() * 1000);
        continue;
      } else if (target.requiresLogin) {
        targetMissingLogged = false;
        await this.options.emitManual("login", "manual-intervention-appears", "target round requires login", "Login required");
        await sleep(1000);
        continue;
      } else if (target.soldOut) {
        targetMissingLogged = false;
        this.options.emit({ type: "state", botId: this.options.botId, state: "AWAITING_USER", detail: "Target round sold out" });
        this.options.emit({ type: "log", botId: this.options.botId, message: `target round sold out: ${target.dateText} ${target.timeText}` });
        return;
      } else {
        targetMissingLogged = false;
      }

      if (Date.now() >= nextReloadAt) {
        await this.options.forensics.captureDecision("acquisition-reload");
        this.options.forensics.event("acquisition", "reload", { saleStart: this.options.concert.sale_start });
        await p.reload({ waitUntil: "domcontentloaded" }).catch(() => undefined);
        nextReloadAt = Date.now() + nextAcquisitionReloadDelayMs(new Date(), this.options.concert.sale_start, this.options.botId);
      }
      await sleep(500);
    }
  }

  private async requireTargetRound(p: Page): Promise<TargetRoundState> {
    const targetRound = this.options.concert.target_round;
    if (!targetRound) throw new Error("target_round is required for queue-ready mode");
    await this.options.forensics.captureDecision("preflight-target");
    this.options.forensics.event("target-resolve", "start", { targetRound });
    const target = await resolveTargetRoundOnPage(p, targetRound);
    if (!target) {
      this.options.forensics.event("target-resolve", "not-found", { targetRound });
      throw new Error(`Target round not found: ${targetRound.type} ${targetRound.date} ${targetRound.time}`);
    }
    this.options.forensics.event("target-resolve", "found", {
      targetRound,
      disabled: target.disabled,
      queueOrBookingCapable: target.queueOrBookingCapable,
    });
    return target;
  }

  private async clickTargetRound(p: Page, target: TargetRoundState): Promise<void> {
    const selector = `a.btn[data-button="${escapeCssAttributeValue(target.dataButton)}"]`;
    this.options.emit({ type: "log", botId: this.options.botId, message: `clicking target round ${selector}` });
    await this.options.forensics.captureDecision("acquisition-target-click-before");
    this.options.forensics.event("target-click", "start", { selector, targetRound: this.options.concert.target_round });
    try {
      await p.locator(selector).first().click({ timeout: 3000 });
    } catch (error) {
      const kind = classifyPage(p.url());
      if (kind === "login" || kind === "zones" || kind === "queue" || kind === "fixed" || kind === "payment" || kind === "enroll") {
        this.options.emit({ type: "log", botId: this.options.botId, message: `target click navigated to ${kind}; continuing` });
      } else {
        throw error;
      }
    }
    await p.waitForLoadState("domcontentloaded", { timeout: 10000 }).catch(() => undefined);
    await this.options.forensics.captureDecision("acquisition-target-click-after");
    this.options.forensics.event("target-click", "done", { selector });
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function escapeCssAttributeValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}
