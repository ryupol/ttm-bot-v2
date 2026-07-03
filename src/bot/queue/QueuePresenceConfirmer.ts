import type { Page } from "playwright";
import { classifyPage } from "../routing/PageClassifier.ts";

export type QueueForensicCallbacks = {
  captureDecision?: (label: string) => Promise<void>;
  event?: (action: string, result: string, extra?: Record<string, unknown>) => void;
};

export type QueuePresenceResult =
  | { status: "none" }
  | { status: "clicked"; clickedAt: number }
  | { status: "failed"; error: string; shouldEmitManualAlert: boolean };

type QueuePresenceConfirmerOptions = {
  botId: number;
  forensics?: QueueForensicCallbacks;
  cooldownMs?: number;
  maxClicks?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  settleMs?: number;
};

export class QueuePresenceConfirmer {
  private readonly botId: number;
  private readonly cooldownMs: number;
  private clickCount = 0;
  private failureVisible = false;
  private readonly forensics?: QueueForensicCallbacks;
  private lastClickAt = Number.NEGATIVE_INFINITY;
  private readonly maxClicks: number;
  private readonly now: () => number;
  private readonly settleMs: number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(options: QueuePresenceConfirmerOptions) {
    this.botId = options.botId;
    this.cooldownMs = options.cooldownMs ?? 30_000;
    this.forensics = options.forensics;
    this.maxClicks = options.maxClicks ?? 20;
    this.now = options.now ?? Date.now;
    this.settleMs = options.settleMs ?? 300;
    this.sleep = options.sleep ?? sleep;
  }

  async tryConfirm(page: Page): Promise<QueuePresenceResult> {
    if (!isWaitHost(page.url())) return { status: "none" };
    if (classifyPage(page.url()) !== "queue") return { status: "none" };
    if (this.clickCount >= this.maxClicks) return { status: "none" };
    const now = this.now();
    if (now - this.lastClickAt < this.cooldownMs) return { status: "none" };

    const html = await page.content().catch(() => "");
    if (!hasPresenceMarkers(html)) return { status: "none" };

    const button = page.locator("#buttonConfirmVisitorPresence").first();
    const visible = await button.isVisible({ timeout: 300 }).catch(() => false);
    if (!visible) return { status: "none" };
    const enabled = await button.isEnabled({ timeout: 300 }).catch(() => false);
    if (!enabled) return { status: "none" };
    const buttonText = await button.textContent({ timeout: 300 }).catch(() => "");
    if (buttonText && !/yes,\s*i['’]m here|i['’]m here|here/i.test(buttonText)) return { status: "none" };

    try {
      await this.forensics?.captureDecision?.("queue-presence-confirm-before-click");
      this.forensics?.event?.("queue-presence-confirm", "detected", {
        botId: this.botId,
        selector: "#buttonConfirmVisitorPresence",
      });
      await button.click({ timeout: 3000 });
      await this.sleep(this.settleMs);
      await this.forensics?.captureDecision?.("queue-presence-confirm-after-click");
      this.forensics?.event?.("queue-presence-confirm", "clicked", {
        botId: this.botId,
        selector: "#buttonConfirmVisitorPresence",
      });
      this.lastClickAt = now;
      this.clickCount += 1;
      this.failureVisible = false;
      return { status: "clicked", clickedAt: now };
    } catch (error) {
      const shouldEmitManualAlert = !this.failureVisible;
      this.failureVisible = true;
      return {
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
        shouldEmitManualAlert,
      };
    }
  }
}

function isWaitHost(url: string): boolean {
  try {
    return new URL(url).host.toLowerCase() === "wait.thaiticketmajor.com";
  } catch {
    return false;
  }
}

function hasPresenceMarkers(html: string): boolean {
  return html.includes("buttonConfirmVisitorPresence") &&
    html.includes("Still here?") &&
    html.includes("Please confirm you're still waiting") &&
    html.includes("Yes, I'm here");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
