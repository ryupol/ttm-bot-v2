import type { Page } from "playwright";
import type { Concert } from "../../config/schema.ts";
import type { BotEvent } from "../../ipc/types.ts";
import {
  detectManualInterventionOnPage,
  transitionManualIntervention,
  type ManualInterventionReason,
  type ManualInterventionState,
} from "../manual/ManualIntervention.ts";
import type { Notifier } from "../observability/Notifier.ts";
import { classifyPage } from "../routing/PageClassifier.ts";
import { QueuePresenceConfirmer, type QueueForensicCallbacks } from "./QueuePresenceConfirmer.ts";

export type { QueueForensicCallbacks } from "./QueuePresenceConfirmer.ts";

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
  const presenceConfirmer = new QueuePresenceConfirmer({ botId, forensics });

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
      const presence = await presenceConfirmer.tryConfirm(page);
      if (presence.status === "failed" && presence.shouldEmitManualAlert) {
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
  if (manual.present && !isRoutableQueueExit(page.url())) {
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

function isRoutableQueueExit(url: string): boolean {
  return [
    "verify",
    "verify_condition",
    "zones",
    "fixed",
    "payment",
    "enroll",
    "error",
  ].includes(classifyPage(url));
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
