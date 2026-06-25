import path from "node:path";
import { parentPort, workerData } from "node:worker_threads";
import { chromium, type BrowserContext, type Page } from "playwright";
import type { BotCommand, BotEvent, WorkerInit } from "../ipc/types.js";
import { classifyPage } from "./pages/classifier.js";
import { selectSeatsOnFixedPage } from "./pages/fixed.js";
import { holdQueue } from "./pages/queue.js";
import { createNotifierFromEnv } from "./notifier.js";
import { tileBrowserWindow } from "./windowLayout.js";

const init = workerData as WorkerInit;
let context: BrowserContext | undefined;
let page: Page | undefined;
let stopped = false;
const notifier = createNotifierFromEnv(init.config.settings);

void main();

async function main(): Promise<void> {
  if (!parentPort) throw new Error("worker requires parentPort");
  parentPort.on("message", (command: BotCommand) => {
    void handleCommand(command);
  });

  try {
    await launch();
    emit({ type: "state", botId: init.botId, state: "IDLE", detail: "Manual login" });
    emit({ type: "log", botId: init.botId, message: "browser opened; log in manually, then run prepare" });
  } catch (error) {
    emitError(error);
  }
}

async function handleCommand(command: BotCommand): Promise<void> {
  try {
    if (command.type === "stop") {
      stopped = true;
      emit({ type: "state", botId: init.botId, state: "STOPPED", detail: "Stopped by user" });
      return;
    }

    stopped = false;
    if (!page) await launch();

    if (command.type === "prepare") await prepare();
    if (command.type === "go") await go(command.scheduledFor);
    if (command.type === "reset") await reset();
    if (command.type === "assign") await assign();
  } catch (error) {
    emitError(error);
  }
}

async function launch(): Promise<void> {
  const profileDir = path.join(init.config.rootDir, "bot_data", `worker_${init.botId}`);
  context = await chromium.launchPersistentContext(profileDir, {
    headless: init.config.settings.headless,
    channel: init.config.settings.browser.channel,
    viewport: null,
    args: ["--disable-blink-features=AutomationControlled"],
  });
  page = context.pages()[0] ?? await context.newPage();
  await page.goto(init.config.settings.base_url, { waitUntil: "domcontentloaded" });
  try {
    await tileBrowserWindow(context, init.botId - 1, init.totalBots, init.config.settings);
  } catch (error) {
    emit({ type: "log", botId: init.botId, message: `window tiling skipped: ${errorMessage(error)}` });
  }
}

async function prepare(): Promise<void> {
  const p = requirePage();
  emit({ type: "log", botId: init.botId, message: "loading event page" });
  await p.goto(init.config.concert.event_url, { waitUntil: "domcontentloaded" });
  emit({ type: "state", botId: init.botId, state: "READY", detail: "Event page loaded" });
}

async function go(scheduledFor?: string): Promise<void> {
  const p = requirePage();
  emit({
    type: "state",
    botId: init.botId,
    state: "IN_QUEUE",
    detail: scheduledFor ? `Started by timer ${scheduledFor}` : "Started manually",
  });
  await p.goto(init.config.concert.event_url, { waitUntil: "domcontentloaded" });
  await clickBuyNowIfPresent(p);
  await handleCurrentPage();
}

async function assign(): Promise<void> {
  emit({ type: "log", botId: init.botId, message: "assign received; handling current page" });
  await handleCurrentPage({ waitForFixed: true });
}

async function reset(): Promise<void> {
  stopped = false;
  const p = requirePage();
  await p.goto(init.config.settings.base_url, { waitUntil: "domcontentloaded" });
  emit({ type: "state", botId: init.botId, state: "IDLE", detail: "Reset; manual login" });
}

async function handleCurrentPage(options: { waitForFixed?: boolean } = {}): Promise<void> {
  const p = requirePage();
  if (stopped) return;

  if (options.waitForFixed && !p.url().includes("fixed.php")) {
    emit({ type: "state", botId: init.botId, state: "AWAITING_USER", detail: "Waiting for fixed.php" });
    await p.waitForURL((url) => url.toString().includes("fixed.php"), {
      timeout: init.config.settings.manual_solve_timeout * 1000,
    });
  }

  const kind = classifyPage(p.url());
  emit({ type: "log", botId: init.botId, message: `page classified: ${kind}` });

  if (kind === "queue") {
    await holdQueue(p, init.config.concert, init.botId, notifier, emit, init.config.settings.manual_solve_timeout);
    return;
  }

  if (kind === "fixed") {
    await bookSeats(p);
    return;
  }

  if (kind === "payment") {
    emit({ type: "state", botId: init.botId, state: "DONE", detail: "Payment page" });
    return;
  }

  emit({ type: "state", botId: init.botId, state: "AWAITING_USER", detail: `Manual step: ${kind}` });
}

async function bookSeats(p: Page): Promise<void> {
  emit({ type: "state", botId: init.botId, state: "BOOKING", detail: "Selecting seats" });
  const result = await selectSeatsOnFixedPage(p, init.config.concert);
  if (!result || result.status === "no_seats" || result.status === "no_picks") {
    const zone = currentZone(p.url());
    const message = `Bot ${init.botId}: Zone ${zone ?? "unknown"} - no seats available`;
    emit({ type: "alert", botId: init.botId, kind: "no_seats", message, zone });
    await notifyBestEffort(message);
    emit({ type: "state", botId: init.botId, state: "AWAITING_USER", detail: "No seats" });
    return;
  }
  if (result.status !== "confirmed") {
    throw new Error(`Seat selection failed: ${result.status}${"error" in result ? ` ${result.error}` : ""}`);
  }

  const zone = currentZone(p.url());
  const seatText = result.picks.map((seat) => `${seat.row}-${seat.col}`).join(", ");
  const message = `Bot ${init.botId}: Seats selected - Zone ${zone ?? "unknown"}, Seats ${seatText}`;
  emit({ type: "alert", botId: init.botId, kind: "seats_selected", message, seats: result.picks, zone });
  await notifyBestEffort(message);
  emit({ type: "state", botId: init.botId, state: "DONE", detail: "Seats confirmed" });
}

async function clickBuyNowIfPresent(p: Page): Promise<void> {
  const selector = init.config.concert.selectors.buy_now_btn;
  try {
    const buyNow = p.locator(selector).first();
    if (await buyNow.isVisible({ timeout: 1500 })) {
      await buyNow.click({ timeout: 3000 });
      await p.waitForLoadState("domcontentloaded", { timeout: 10000 }).catch(() => undefined);
    }
  } catch (error) {
    emit({ type: "log", botId: init.botId, message: `buy button not clicked: ${errorMessage(error)}` });
  }
}

async function notifyBestEffort(message: string): Promise<void> {
  try {
    await notifier.send(message);
  } catch (error) {
    emit({ type: "log", botId: init.botId, message: `telegram failed: ${errorMessage(error)}` });
  }
}

function requirePage(): Page {
  if (!page) throw new Error("browser page not ready");
  return page;
}

function emit(event: BotEvent): void {
  parentPort?.postMessage(event);
}

function emitError(error: unknown): void {
  emit({ type: "error", botId: init.botId, message: errorMessage(error), stack: error instanceof Error ? error.stack : undefined });
  emit({ type: "state", botId: init.botId, state: "ERROR", detail: errorMessage(error) });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function currentZone(url: string): string | undefined {
  try {
    const parsed = new URL(url);
    return parsed.searchParams.get("zone") ?? undefined;
  } catch {
    return undefined;
  }
}
