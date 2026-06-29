import type { Page } from "playwright";
import type { Concert } from "../../config/schema.ts";
import type { BotEvent } from "../../ipc/types.ts";
import type { ManualInterventionReason, ManualInterventionState } from "../models/ManualIntervention.ts";
import { detectManualInterventionOnPage, transitionManualIntervention } from "../manualIntervention.ts";
import type { Notifier } from "../notifier.ts";
import { classifyPage } from "./classifier.ts";

export type QueueForensicCallbacks = {
  captureDecision?: (label: string) => Promise<void>;
  event?: (action: string, result: string, extra?: Record<string, unknown>) => void;
};

export type HoldQueueOptions = QueueForensicCallbacks & {
  shouldStop?: () => boolean;
  shouldEmitManualAlert?: (reason: ManualInterventionReason, url: string) => boolean;
  forensics?: QueueForensicCallbacks;
};

export async function holdQueue(
  page: Page,
  concert: Concert,
  botId: number,
  notifier: Notifier,
  emit: (event: BotEvent) => void,
  options: HoldQueueOptions = {},
): Promise<void> {
  const { queue_url_pattern, captcha_selector, puzzle_selector } = concert.queue_indicators;
  const forensics = normalizeForensics(options);
  if (!await isQueueLike(page, queue_url_pattern)) return;

  emit({ type: "state", botId, state: "IN_QUEUE", detail: "Holding queue" });
  emit({ type: "log", botId, message: `entered queue: ${page.url()}` });

  let manualVisible = false;
  let presenceFailureVisible = false;
  let presenceLastClickAt = Number.NEGATIVE_INFINITY;
  let presenceClickCount = 0;

  while (!options.shouldStop?.() && await isQueueLike(page, queue_url_pattern)) {
    const manual = await detectManualOrConfiguredCaptcha(page, captcha_selector, puzzle_selector);
    const transition = transitionManualIntervention(manualVisible, manual.present);
    if (transition === "appeared" && manual.present) {
      manualVisible = true;
      await emitManualIntervention(manual.reason, manual.userMessage, page.url(), botId, notifier, emit, forensics, "manual-intervention-appears", options.shouldEmitManualAlert);
    }
    if (transition === "cleared") {
      manualVisible = false;
      await forensics?.captureDecision?.("manual-intervention-clears");
      forensics?.event?.("manual-intervention", "cleared");
      emit({ type: "log", botId, message: "manual intervention cleared" });
      emit({ type: "state", botId, state: "IN_QUEUE", detail: "Holding queue" });
    }
    if (!manual.present) {
      const presence = await maybeConfirmVisitorPresence(page, {
        botId,
        forensics,
        lastClickAt: presenceLastClickAt,
        clickCount: presenceClickCount,
      });
      if (presence.status === "clicked") {
        presenceLastClickAt = presence.clickedAt;
        presenceClickCount += 1;
        presenceFailureVisible = false;
      }
      if (presence.status === "failed" && !presenceFailureVisible) {
        presenceFailureVisible = true;
        await emitManualIntervention(
          "queue_presence_confirm",
          "Queue presence confirmation required",
          page.url(),
          botId,
          notifier,
          emit,
          forensics,
          "manual-intervention-appears",
          options.shouldEmitManualAlert,
        );
      }
    }
    await sleep(jitter(800, 1200));
  }

  if (options.shouldStop?.()) return;

  const manual = await detectManualOrConfiguredCaptcha(page, captcha_selector, puzzle_selector);
  if (manual.present) {
    forensics?.event?.("manual-intervention", "after-queue", { reason: manual.reason });
    if (manualVisible) return;
    await emitManualIntervention(manual.reason, manual.userMessage, page.url(), botId, notifier, emit, forensics, "manual-intervention-appears", options.shouldEmitManualAlert);
    return;
  }

  await forensics?.captureDecision?.("queue-exit");
  forensics?.event?.("queue", "exit", { url: page.url(), pageKind: await classifyQueueExit(page) });
}

async function detectManualOrConfiguredCaptcha(
  page: Page,
  captchaSelector: string,
  puzzleSelector: string,
): Promise<ManualInterventionState> {
  const manual = await detectManualInterventionOnPage(page);
  if (manual.present) return manual;

  for (const selector of [captchaSelector, puzzleSelector]) {
    if (!selector) continue;
    const detected = await selectorVisible(page, selector, 300);
    if (detected) return { present: true, reason: "captcha", userMessage: "Human check required" };
  }

  return { present: false };
}

async function isQueueLike(page: Page, configuredPattern: string): Promise<boolean> {
  const url = page.url();
  if (configuredPattern && url.includes(configuredPattern)) return true;
  const kind = classifyPage(url);
  if (kind === "queue") return true;
  if (kind !== "unknown") return false;
  const html = await page.content().catch(() => "");
  return classifyPage(url, html) === "queue";
}

async function classifyQueueExit(page: Page): Promise<string> {
  const url = page.url();
  const kind = classifyPage(url);
  if (kind !== "unknown") return kind;
  const html = await page.content().catch(() => "");
  return classifyPage(url, html);
}

type PresenceResult =
  | { status: "none" }
  | { status: "clicked"; clickedAt: number }
  | { status: "failed"; error: string };

async function maybeConfirmVisitorPresence(
  page: Page,
  state: {
    botId: number;
    forensics?: QueueForensicCallbacks;
    lastClickAt: number;
    clickCount: number;
  },
): Promise<PresenceResult> {
  if (!isWaitHost(page.url())) return { status: "none" };
  if (classifyPage(page.url()) !== "queue") return { status: "none" };
  if (state.clickCount >= 20) return { status: "none" };
  const now = Date.now();
  if (now - state.lastClickAt < 30_000) return { status: "none" };

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
    await state.forensics?.captureDecision?.("queue-presence-confirm-before-click");
    state.forensics?.event?.("queue-presence-confirm", "detected", {
      botId: state.botId,
      selector: "#buttonConfirmVisitorPresence",
    });
    await button.click({ timeout: 3000 });
    await sleep(300);
    await state.forensics?.captureDecision?.("queue-presence-confirm-after-click");
    state.forensics?.event?.("queue-presence-confirm", "clicked", {
      botId: state.botId,
      selector: "#buttonConfirmVisitorPresence",
    });
    return { status: "clicked", clickedAt: now };
  } catch (error) {
    return { status: "failed", error: error instanceof Error ? error.message : String(error) };
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

async function emitManualIntervention(
  reason: ManualInterventionReason,
  userMessage: string,
  url: string,
  botId: number,
  notifier: Notifier,
  emit: (event: BotEvent) => void,
  forensics: QueueForensicCallbacks | undefined,
  captureLabel: string,
  shouldEmitManualAlert?: (reason: ManualInterventionReason, url: string) => boolean,
): Promise<void> {
  if (shouldEmitManualAlert && !shouldEmitManualAlert(reason, url)) return;
  const message = `Bot ${botId}: manual intervention (${userMessage}) - solve in browser`;
  await forensics?.captureDecision?.(captureLabel);
  forensics?.event?.("manual-intervention", "appeared", { reason, userMessage });
  emit({ type: "state", botId, state: "MANUAL_INTERVENTION", detail: userMessage });
  emit({ type: "alert", botId, kind: "manual_intervention", message });
  await notifyBestEffort(notifier, message, emit, botId);
}

function normalizeForensics(options: HoldQueueOptions): QueueForensicCallbacks | undefined {
  return options.forensics ?? (
    options.captureDecision || options.event
      ? { captureDecision: options.captureDecision, event: options.event }
      : undefined
  );
}

async function selectorVisible(page: Page, selector: string, timeout: number): Promise<boolean> {
  try {
    await page.waitForSelector(selector, { timeout, state: "visible" });
    return true;
  } catch {
    return false;
  }
}

async function notifyBestEffort(
  notifier: Notifier,
  message: string,
  emit: (event: BotEvent) => void,
  botId: number,
): Promise<void> {
  try {
    await notifier.send(message);
  } catch (error) {
    emit({ type: "log", botId, message: `telegram failed: ${error instanceof Error ? error.message : String(error)}` });
  }
}

function jitter(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
