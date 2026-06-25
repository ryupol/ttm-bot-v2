import type { Page } from "playwright";
import type { Concert } from "../../config/schema.js";
import type { BotEvent } from "../../ipc/types.js";
import type { Notifier } from "../notifier.js";

export async function holdQueue(
  page: Page,
  concert: Concert,
  botId: number,
  notifier: Notifier,
  emit: (event: BotEvent) => void,
  timeoutSeconds: number,
): Promise<void> {
  const { queue_url_pattern, captcha_selector, puzzle_selector } = concert.queue_indicators;
  if (!page.url().includes(queue_url_pattern)) return;

  emit({ type: "state", botId, state: "IN_QUEUE", detail: "Holding queue" });
  emit({ type: "log", botId, message: `entered queue: ${page.url()}` });

  const deadline = Date.now() + timeoutSeconds * 1000;
  let captchaAlerted = false;

  while (page.url().includes(queue_url_pattern) && Date.now() < deadline) {
    for (const selector of [captcha_selector, puzzle_selector]) {
      if (!selector) continue;
      const detected = await selectorVisible(page, selector, 300);
      if (!detected || captchaAlerted) continue;

      captchaAlerted = true;
      const message = `Bot ${botId}: CAPTCHA detected - solve in browser`;
      emit({ type: "alert", botId, kind: "captcha_detected", message });
      await notifyBestEffort(notifier, message, emit, botId);
    }
    await sleep(jitter(800, 1200));
  }

  if (page.url().includes(queue_url_pattern)) {
    throw new Error(`Bot ${botId} stuck in queue after ${timeoutSeconds}s`);
  }

  const message = `Bot ${botId}: Out of queue - fill form manually`;
  emit({ type: "state", botId, state: "AWAITING_USER", detail: "Manual form step" });
  emit({ type: "alert", botId, kind: "queue_exit", message });
  await notifyBestEffort(notifier, message, emit, botId);
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
