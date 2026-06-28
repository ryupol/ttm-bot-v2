import path from "node:path";
import { parentPort, workerData } from "node:worker_threads";
import { chromium, type BrowserContext, type Page } from "playwright";
import type { BotCommand, BotEvent, PickedSeat, WorkerInit } from "../ipc/types.ts";
import { attachForensicListeners, createRunForensics, type RunForensics } from "./forensics.ts";
import { createManualAlertDeduper } from "./manualAlertDeduper.ts";
import { classifyUnknownManualPage, detectManualInterventionOnPage, transitionManualIntervention } from "./manualIntervention.ts";
import { waitForManualInterventionToClear } from "./manualRecovery.ts";
import { commandFlowForPage, waitForFixedPageNavigation, zoneFromUrl } from "./pageFlow.ts";
import { classifyCurrentPage, classifyPage, type PageKind } from "./pages/classifier.ts";
import { selectSeatsOnFixedPage } from "./pages/fixed.ts";
import { holdQueue } from "./pages/queue.ts";
import { submitThaiCitizenId, submitVerifyCondition } from "./pages/verify.ts";
import { nextAcquisitionReloadDelayMs } from "./queueSchedule.ts";
import { createNotifierFromEnv } from "./notifier.ts";
import { formatSeatsSelectedMessage } from "./seatAlert.ts";
import { hasLoggedInMarker } from "./session.ts";
import { resolveTargetRoundOnPage, type TargetRoundState } from "./targetRound.ts";
import { tileBrowserWindow } from "./windowLayout.ts";
import { nextZoneAfter } from "./zonePriority.ts";

const init = workerData as WorkerInit;
let context: BrowserContext | undefined;
let page: Page | undefined;
let stopped = false;
let forensics: RunForensics | undefined;
const forensicListenerPages = new WeakSet<Page>();
const notifier = createNotifierFromEnv(init.config.settings);
let zonesBaseUrl: string | undefined;
let currentBookingZone: string | undefined;
const zonesTried = new Set<string>();
let lastAccessBlock: { code: 403 | 428; url: string; at: number } | undefined;
let suppressAccessBlockUntil = 0;
const manualAlertDeduper = createManualAlertDeduper({ cooldownMs: 10_000 });

void main();

async function main(): Promise<void> {
  if (!parentPort) throw new Error("worker requires parentPort");
  parentPort.on("message", (command: BotCommand) => {
    void handleCommand(command);
  });

  try {
    if (init.config.concert.observability.mode === "forensic" && init.runId) {
      const observability = init.config.concert.observability;
      forensics = createRunForensics({
        artifactRoot: resolveArtifactRoot(init.config.rootDir, observability.artifact_root),
        runId: init.runId,
        botCount: init.totalBots,
        targetRound: init.config.concert.target_round,
        queueStart: init.config.concert.queue_start,
        saleStart: init.config.concert.sale_start,
        captureHtml: observability.capture_html,
        captureScreenshot: observability.capture_screenshot,
        captureNetworkFailures: observability.capture_network_failures,
        captureConsoleErrors: observability.capture_console_errors,
      });
    }
    await launch();
    emit({ type: "state", botId: init.botId, state: "IDLE", detail: "Auto login starting" });
    emit({ type: "log", botId: init.botId, message: "browser opened; auto login will run, submit manually if needed, then go all" });
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

    if (command.type === "shutdown") {
      stopped = true;
      emit({ type: "state", botId: init.botId, state: "STOPPED", detail: "Shutting down" });
      await context?.close().catch(() => undefined);
      process.exit(0);
    }

    stopped = false;
    if (!page) await launch();

    if (command.type === "login") await login();
    else if (command.type === "check") await checkStatus();
    else if (command.type === "go") await go(command.scheduledFor);
    else if (command.type === "reset") await reset();
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
  const oldPages = context.pages();
  page = await context.newPage();
  await Promise.all(oldPages.map((oldPage) => oldPage.close().catch(() => undefined)));
  if (forensics && !forensicListenerPages.has(page)) {
    attachForensicListeners(page, forensics, init.botId);
    forensicListenerPages.add(page);
  }
  page.on("response", (response) => {
    const status = response.status();
    if (status !== 403 && status !== 428) return;
    if (!isRelevantAccessBlockResponse(response.url(), response.request().resourceType())) return;
    if (Date.now() < suppressAccessBlockUntil) {
      emit({ type: "log", botId: init.botId, message: `ignored access block after confirmed login: ${status}` });
      return;
    }
    lastAccessBlock = { code: status, url: response.url(), at: Date.now() };
    emit({ type: "state", botId: init.botId, state: "MANUAL_INTERVENTION", detail: `Access blocked: ${status}` });
    emit({ type: "log", botId: init.botId, message: `access blocked: ${status}` });
  });
  await page.goto(init.config.settings.base_url, { waitUntil: "domcontentloaded" });
  try {
    await tileBrowserWindow(context, init.botId - 1, init.totalBots, init.config.settings);
  } catch (error) {
    emit({ type: "log", botId: init.botId, message: `window tiling skipped: ${errorMessage(error)}` });
  }
}

function isRelevantAccessBlockResponse(url: string, resourceType: string): boolean {
  if (resourceType !== "document" && resourceType !== "xhr" && resourceType !== "fetch") return false;
  try {
    const host = new URL(url).host.toLowerCase();
    return host.endsWith("thaiticketmajor.com") || host.endsWith("ticketmaster.co.th") || host.endsWith("gatekeeper.thaiticketmajor.com");
  } catch {
    return false;
  }
}

async function login(): Promise<void> {
  const p = requirePage();
  if (await emitDoneIfTerminal(p, "login skipped")) return;
  await p.goto(init.config.concert.event_url, { waitUntil: "domcontentloaded" });
  emitRecentAccessBlock();
  if (await isLoggedIn(p)) {
    clearAccessBlockAfterSuccessfulLogin();
    emit({ type: "state", botId: init.botId, state: "READY", detail: "Logged in" });
    emit({ type: "log", botId: init.botId, message: "already logged in" });
    return;
  }

  await openAndFillLoginForm(p);
}

async function requireTargetRound(p: Page): Promise<TargetRoundState> {
  const targetRound = init.config.concert.target_round;
  if (!targetRound) throw new Error("target_round is required for queue-ready mode");
  await captureDecision("preflight-target");
  forensicEvent("target-resolve", "start", { targetRound });
  const target = await resolveTargetRoundOnPage(p, targetRound);
  if (!target) {
    forensicEvent("target-resolve", "not-found", { targetRound });
    throw new Error(`Target round not found: ${targetRound.type} ${targetRound.date} ${targetRound.time}`);
  }
  forensicEvent("target-resolve", "found", {
    targetRound,
    disabled: target.disabled,
    queueOrBookingCapable: target.queueOrBookingCapable,
  });
  return target;
}

async function openAndFillLoginForm(p: Page): Promise<void> {
  if (await emitDoneIfTerminal(p, "login skipped")) return;
  await p.goto("https://event.thaiticketmajor.com/user/signin.php?redir=/concert/", { waitUntil: "domcontentloaded" });
  emitRecentAccessBlock();
  const manual = await detectManualInterventionOnPage(p);
  if (manual.present && manual.reason !== "login") {
    await emitManual(manual.reason, "manual-intervention-appears", manual.detail, manual.userMessage);
    return;
  }

  const email = init.account.email?.trim() ?? "";
  const password = init.account.password?.trim() ?? "";
  if (!email || !password) {
    emit({ type: "state", botId: init.botId, state: "MANUAL_INTERVENTION", detail: "Login required" });
    emit({ type: "log", botId: init.botId, message: "login required" });
    return;
  }

  const username = p.locator("#frm-signin-page input[name='username']").first();
  const pass = p.locator("#frm-signin-page input[name='password']").first();
  try {
    await username.waitFor({ state: "visible", timeout: 8000 });
    if (await username.inputValue().catch(() => "") !== email) await username.fill(email);
    if (await pass.inputValue().catch(() => "") !== password) await pass.fill(password);
    emit({ type: "log", botId: init.botId, message: "login form filled" });
  } catch {
    emit({ type: "log", botId: init.botId, message: "login required" });
  }
  emit({ type: "state", botId: init.botId, state: "MANUAL_INTERVENTION", detail: "Login required" });
}

async function isLoggedIn(p: Page): Promise<boolean> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    await p.waitForTimeout(1000);
    const html = await p.content().catch(() => "");
    if (hasLoggedInMarker(html)) return true;
  }
  return false;
}

function emitRecentAccessBlock(maxAgeMs = 120_000): boolean {
  if (Date.now() < suppressAccessBlockUntil) return false;
  if (!lastAccessBlock) return false;
  if (Date.now() - lastAccessBlock.at > maxAgeMs) return false;
  emit({ type: "state", botId: init.botId, state: "MANUAL_INTERVENTION", detail: `Access blocked: ${lastAccessBlock.code}` });
  emit({ type: "log", botId: init.botId, message: `access blocked: ${lastAccessBlock.code}` });
  return true;
}

function clearAccessBlockAfterSuccessfulLogin(): void {
  lastAccessBlock = undefined;
  suppressAccessBlockUntil = Date.now() + 10_000;
}

async function emitDoneIfTerminal(p: Page, logMessage: string): Promise<boolean> {
  const kind = await classifyCurrentPage(p);
  if (kind !== "payment" && kind !== "enroll") return false;
  emitDone(kind);
  emit({ type: "log", botId: init.botId, message: logMessage });
  return true;
}

function emitDone(kind: PageKind): void {
  const detail = kind === "enroll" ? "Enroll page" : "Payment page";
  forensicEvent("booking", kind === "enroll" ? "enroll-page" : "payment-page");
  emit({ type: "state", botId: init.botId, state: "DONE", detail });
}

async function go(scheduledFor?: string): Promise<void> {
  const p = requirePage();
  const kind = await classifyCurrentPage(p);
  if (await emitDoneIfTerminal(p, "already done")) return;
  if (kind === "login") {
    await openAndFillLoginForm(p);
    return;
  }
  if (commandFlowForPage(kind) === "resume") {
    emit({ type: "log", botId: init.botId, message: `go resumes current page: ${kind} ${p.url()}` });
    await handleCurrentPage();
    return;
  }
  await runQueueAcquisition(p, scheduledFor ? `Started by timer ${scheduledFor}` : "Started manually");
}

async function runQueueAcquisition(p: Page, detail: string): Promise<void> {
  emit({
    type: "state",
    botId: init.botId,
    state: "WATCHING_QUEUE_OPEN",
    detail,
  });
  await p.goto(init.config.concert.event_url, { waitUntil: "domcontentloaded" });
  await requireTargetRound(p);
  let nextReloadAt = Date.now() + nextAcquisitionReloadDelayMs(new Date(), init.config.concert.sale_start, init.botId);
  let manualVisible = false;
  let targetMissingLogged = false;
  let unknownVisible = false;

  while (!stopped) {
    const kind = await classifyCurrentPage(p);
    if (kind === "queue") {
      await captureDecision("queue-entered");
      forensicEvent("queue", "entered");
      await holdQueue(p, init.config.concert, init.botId, notifier, emit, {
        shouldStop: () => stopped,
        shouldEmitManualAlert,
        forensics: { captureDecision, event: forensicEvent },
      });
      if (stopped) return;
      await handleCurrentPage();
      return;
    }
    if (kind === "zones" || kind === "fixed" || kind === "payment" || kind === "enroll") {
      await handleCurrentPage();
      return;
    }

    const manual = await detectManualInterventionOnPage(p);
    const transition = transitionManualIntervention(manualVisible, manual.present);
    if (transition === "appeared" && manual.present) {
      manualVisible = true;
      await emitManual(manual.reason, "manual-intervention-appears", manual.detail, manual.userMessage);
    }
    if (manual.present) {
      await sleep(1000);
      continue;
    }
    if (transition === "cleared") {
      manualVisible = false;
      await captureDecision("manual-intervention-clears");
      forensicEvent("manual-intervention", "cleared");
      emit({ type: "state", botId: init.botId, state: "WATCHING_QUEUE_OPEN", detail: "Manual step cleared" });
    }

    if (kind === "unknown") {
      const unknownManual = classifyUnknownManualPage({ url: p.url(), knownPage: false });
      if (!unknownVisible && unknownManual.present) {
        unknownVisible = true;
        await emitManual(unknownManual.reason, "manual-intervention-unknown-page", unknownManual.detail, unknownManual.userMessage);
        await waitForManualClearThenResume(p);
      }
      return;
    }
    unknownVisible = false;

    const targetRound = init.config.concert.target_round;
    const target = targetRound ? await resolveTargetRoundOnPage(p, targetRound) : undefined;
    if (!target) {
      if (!targetMissingLogged) {
        emit({ type: "log", botId: init.botId, message: "target round not found during watch; retrying" });
        targetMissingLogged = true;
      }
    } else if (target.queueOrBookingCapable) {
      targetMissingLogged = false;
      await clickTargetRound(p, target);
      await sleep(2000 + Math.random() * 1000);
      continue;
    } else if (target.soldOut) {
      targetMissingLogged = false;
      emit({ type: "state", botId: init.botId, state: "AWAITING_USER", detail: "Target round sold out" });
      emit({ type: "log", botId: init.botId, message: `target round sold out: ${target.dateText} ${target.timeText}` });
      return;
    } else {
      targetMissingLogged = false;
    }

    if (Date.now() >= nextReloadAt) {
      await captureDecision("acquisition-reload");
      forensicEvent("acquisition", "reload", { saleStart: init.config.concert.sale_start });
      await p.reload({ waitUntil: "domcontentloaded" }).catch(() => undefined);
      nextReloadAt = Date.now() + nextAcquisitionReloadDelayMs(new Date(), init.config.concert.sale_start, init.botId);
    }
    await sleep(500);
  }
}

async function clickTargetRound(p: Page, target: TargetRoundState): Promise<void> {
  const selector = `a.btn[data-button="${escapeCssAttributeValue(target.dataButton)}"]`;
  emit({ type: "log", botId: init.botId, message: `clicking target round ${selector}` });
  await captureDecision("acquisition-target-click-before");
  forensicEvent("target-click", "start", { selector, targetRound: init.config.concert.target_round });
  try {
    await p.locator(selector).first().click({ timeout: 3000 });
  } catch (error) {
    const kind = classifyPage(p.url());
    if (kind === "login" || kind === "zones" || kind === "queue" || kind === "fixed" || kind === "payment" || kind === "enroll") {
      emit({ type: "log", botId: init.botId, message: `target click navigated to ${kind}; continuing` });
    } else {
      throw error;
    }
  }
  await p.waitForLoadState("domcontentloaded", { timeout: 10000 }).catch(() => undefined);
  await captureDecision("acquisition-target-click-after");
  forensicEvent("target-click", "done", { selector });
}

async function checkStatus(): Promise<void> {
  if (stopped) {
    emit({ type: "state", botId: init.botId, state: "STOPPED", detail: "Stopped by user" });
    return;
  }
  const p = requirePage();
  if (emitRecentAccessBlock()) return;
  const kind = await classifyCurrentPage(p);
  const manual = await detectManualInterventionOnPage(p);
  const detail = `Current page: ${kind}${manual.present ? `; manual=${manual.reason}` : ""}`;
  emit({ type: "log", botId: init.botId, message: `check: ${detail}; url=${p.url()}` });

  if (manual.present) {
    emit({ type: "state", botId: init.botId, state: "MANUAL_INTERVENTION", detail: manual.userMessage });
    return;
  }
  if (kind === "queue") {
    emit({ type: "state", botId: init.botId, state: "IN_QUEUE", detail: "Current page: queue" });
    return;
  }
  if (kind === "zones" || kind === "fixed") {
    emit({ type: "state", botId: init.botId, state: "BOOKING", detail: `Current page: ${kind}` });
    return;
  }
  if (kind === "payment" || kind === "enroll") {
    emitDone(kind);
    return;
  }
  if (kind === "event") {
    emit({ type: "state", botId: init.botId, state: "READY", detail: "Current page: event" });
    return;
  }
  emit({ type: "state", botId: init.botId, state: "AWAITING_USER", detail });
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

  const kind = await classifyCurrentPage(p);
  emit({ type: "log", botId: init.botId, message: `page classified: ${kind}` });

  if (kind === "unknown") {
    const detected = await detectManualInterventionOnPage(p);
    const manual = detected.present
      ? detected
      : classifyUnknownManualPage({ url: p.url(), knownPage: false });
    if (manual.present) {
      await emitManual(manual.reason, "manual-intervention-appears", manual.detail, manual.userMessage);
      await waitForManualClearThenResume(p);
      return;
    }
  }

  if (kind === "queue") {
    await captureDecision("queue-entered");
    forensicEvent("queue", "entered");
    await holdQueue(p, init.config.concert, init.botId, notifier, emit, {
      shouldStop: () => stopped,
      shouldEmitManualAlert,
      forensics: {
        captureDecision,
        event: forensicEvent,
      },
    });
    if (stopped) return;
    await handleCurrentPage();
    return;
  }

  if (kind === "fixed") {
    await bookSeats(p);
    return;
  }

  if (kind === "verify") {
    await handleVerifyPage(p);
    return;
  }

  if (kind === "verify_condition") {
    await handleVerifyConditionPage(p);
    return;
  }

  if (kind === "error") {
    await recoverFromErrorPage(p);
    return;
  }

  if (kind === "zones") {
    await enterNextZone(p);
    return;
  }

  if (kind === "payment") {
    forensicEvent("booking", "payment-page");
    emit({ type: "state", botId: init.botId, state: "DONE", detail: "Payment page" });
    return;
  }

  if (kind === "enroll") {
    forensicEvent("booking", "enroll-page");
    emit({ type: "state", botId: init.botId, state: "DONE", detail: "Enroll page" });
    return;
  }

  if (kind === "unknown") {
    await captureDecision("manual-intervention-appears");
    forensicEvent("manual-intervention", "awaiting-user", { pageKind: kind });
  }
  emit({ type: "state", botId: init.botId, state: "AWAITING_USER", detail: `Manual step: ${kind}` });
}

async function handleVerifyPage(p: Page): Promise<void> {
  emit({ type: "state", botId: init.botId, state: "BOOKING", detail: "Submitting citizen ID" });
  await captureDecision("before-verify-submit");
  forensicEvent("verify", "start");
  const result = await submitThaiCitizenId(p, init.account);
  await captureDecision("after-verify-submit");
  forensicEvent("verify", result.status, "error" in result ? { error: result.error } : {});

  if (result.status === "passed") {
    emit({ type: "log", botId: init.botId, message: "citizen ID verify passed" });
    await handleCurrentPage();
    return;
  }
  if (result.status === "missing_citizen_id") {
    await emitManual("verify", "manual-intervention-appears", "missing citizen_id", "Verification required");
    return;
  }
  await emitManual("verify", "manual-intervention-appears", "citizen ID verify failed", "Verification required");
  await waitForManualClearThenResume(p);
}

async function handleVerifyConditionPage(p: Page): Promise<void> {
  emit({ type: "state", botId: init.botId, state: "BOOKING", detail: "Confirming terms" });
  await captureDecision("before-verify-condition-submit");
  forensicEvent("verify-condition", "start");
  const result = await submitVerifyCondition(p);
  await captureDecision("after-verify-condition-submit");
  forensicEvent("verify-condition", result.status);

  if (result.status === "submitted") {
    emit({ type: "log", botId: init.botId, message: "verify condition submitted" });
    await handleCurrentPage();
    return;
  }
  await emitManual("terms", "manual-intervention-appears", "confirm button not found", "Terms confirmation required");
  await waitForManualClearThenResume(p);
}

async function recoverFromErrorPage(p: Page): Promise<void> {
  await captureDecision("error-page");
  forensicEvent("error-page", "recover", { zonesBaseUrl });
  if (zonesBaseUrl) {
    emit({ type: "log", botId: init.botId, message: "error page; returning to zones" });
    await p.goto(zonesBaseUrl, { waitUntil: "domcontentloaded" }).catch((error) => {
      emit({ type: "log", botId: init.botId, message: `error recovery failed: ${errorMessage(error)}` });
    });
    if (classifyPage(p.url()) === "zones") {
      await handleCurrentPage();
      return;
    }
  }
  emit({ type: "state", botId: init.botId, state: "AWAITING_USER", detail: "Error page" });
}

async function bookSeats(p: Page): Promise<void> {
  while (!stopped) {
    const zone = zoneFromUrl(p.url()) ?? currentBookingZone;

    emit({ type: "state", botId: init.botId, state: "BOOKING", detail: `Selecting seats${zone ? ` in ${zone}` : ""}` });
    await captureDecision("before-seat-selection");
    forensicEvent("seat-selection", "start", { zone });
    const result = await selectSeatsOnFixedPage(p, init.config.concert);
    if (!result || result.status === "no_seats" || result.status === "no_picks") {
      await captureDecision("after-seat-selection");
      forensicEvent("seat-selection", result?.status ?? "no-result", { zone });
      const securedKind = classifyPage(p.url());
      if (securedKind === "payment" || securedKind === "enroll") {
        forensicEvent("booking", "secured-page-after-selection", { zone, pageKind: securedKind });
        emitDone(securedKind);
        return;
      }
      if (zone) zonesTried.add(zone);

      if (zonesBaseUrl) {
        await p.goto(zonesBaseUrl, { waitUntil: "domcontentloaded" }).catch((error) => {
          emit({ type: "log", botId: init.botId, message: `back to zones failed: ${errorMessage(error)}` });
        });
        if (classifyPage(p.url()) === "zones" && await enterNextZone(p)) {
          continue;
        }
      }

      const nextZone = nextZoneAfter(zone, init.config.concert.zone_priority, zonesTried);
      if (nextZone && await goToZone(p, nextZone)) {
        zonesTried.add(nextZone);
        currentBookingZone = nextZone;
        continue;
      }

      const message = `Bot ${init.botId}: Zone ${zone ?? "unknown"} - no seats available`;
      forensicEvent("booking", "no-seats", { zone });
      emit({ type: "alert", botId: init.botId, kind: "no_seats", message, zone });
      await notifyBestEffort(message);
      emit({ type: "state", botId: init.botId, state: "AWAITING_USER", detail: "No seats" });
      return;
    }
    if (result.status !== "confirmed") {
      await captureDecision("after-seat-selection");
      forensicEvent("seat-selection", result.status, { zone, error: "error" in result ? result.error : undefined });
      throw new Error(`Seat selection failed: ${result.status}${"error" in result ? ` ${result.error}` : ""}`);
    }

    const picks = result.picks.length > 0 ? result.picks : await readPaymentPageSeats(p);
    await captureDecision("after-seat-selection");
    forensicEvent("seat-selection", "confirmed", { zone, picks: picks.length });
    const message = formatSeatsSelectedMessage(init.botId, zone, picks, init.config.concert.ticket_count);
    emit({ type: "alert", botId: init.botId, kind: "seats_selected", message, seats: picks, zone });
    await notifyBestEffort(message);
    forensicEvent("booking", "done", { zone, picks: picks.length });
    const securedKind = classifyPage(p.url());
    if (securedKind === "payment" || securedKind === "enroll") emitDone(securedKind);
    else emit({ type: "state", botId: init.botId, state: "DONE", detail: "Seats confirmed" });
    return;
  }
}

async function readPaymentPageSeats(p: Page): Promise<PickedSeat[]> {
  if (classifyPage(p.url()) !== "payment") return [];
  return p.evaluate(() => {
    const seatText = document.querySelector('[data-selected="seat"]')?.textContent?.trim()
      || document.querySelector<HTMLInputElement>('input[name="seatlist"]')?.value
      || "";
    return seatText
      .split(",")
      .map((seat) => seat.trim().replace(/-P$/, ""))
      .filter(Boolean)
      .map((seat) => {
        const [row, col] = seat.split("-");
        return { id: `payment-${seat}`, row, col: Number.parseInt(col ?? "0", 10) };
      })
      .filter((seat) => seat.row && Number.isFinite(seat.col));
  }).catch(() => []);
}

async function notifyBestEffort(message: string): Promise<void> {
  try {
    await notifier.send(message);
  } catch (error) {
    emit({ type: "log", botId: init.botId, message: `telegram failed: ${errorMessage(error)}` });
  }
}

async function enterNextZone(p: Page): Promise<boolean> {
  zonesBaseUrl = p.url();
  const currentZone = zoneFromUrl(p.url());
  if (currentZone) zonesTried.add(currentZone);
  const nextZone = nextZoneAfter(currentZone, init.config.concert.zone_priority, zonesTried);
  if (!nextZone) {
    emit({ type: "state", botId: init.botId, state: "AWAITING_USER", detail: "Zone page; no zone_priority configured" });
    return false;
  }

  emit({ type: "state", botId: init.botId, state: "BOOKING", detail: `Selecting zone ${nextZone}` });
  await captureDecision("before-zone-selection");
  forensicEvent("zone-selection", "start", { zone: nextZone });
  if (!await goToZone(p, nextZone)) {
    await captureDecision("after-zone-selection");
    forensicEvent("zone-selection", "failed", { zone: nextZone });
    emit({ type: "state", botId: init.botId, state: "AWAITING_USER", detail: `Zone ${nextZone} not selectable` });
    return false;
  }
  currentBookingZone = nextZone;
  await captureDecision("after-zone-selection");
  forensicEvent("zone-selection", "done", { zone: nextZone });
  await handleCurrentPage();
  return true;
}

async function emitManual(reason: string, captureLabel = "manual-intervention-appears", detail?: string, userMessage?: string): Promise<void> {
  if (stopped) return;
  if (page && !shouldEmitManualAlert(reason, page.url())) return;
  const statusDetail = userMessage ?? (detail ? `${reason}: ${detail}` : reason);
  const message = `Bot ${init.botId}: manual intervention (${statusDetail}) - solve in browser`;
  await captureDecision(captureLabel);
  forensicEvent("manual-intervention", "appeared", { reason, detail, userMessage });
  emit({ type: "state", botId: init.botId, state: "MANUAL_INTERVENTION", detail: statusDetail });
  emit({ type: "alert", botId: init.botId, kind: "manual_intervention", message });
  await notifyBestEffort(message);
}

async function waitForManualClearThenResume(p: Page): Promise<void> {
  const result = await waitForManualInterventionToClear(p, {
    shouldStop: () => stopped,
    onCleared: async () => {
      await captureDecision("manual-intervention-clears");
      forensicEvent("manual-intervention", "cleared");
      emit({ type: "log", botId: init.botId, message: "manual intervention cleared" });
    },
  });
  if (result === "cleared" && !stopped) await handleCurrentPage();
}

function shouldEmitManualAlert(reason: string, url: string): boolean {
  return manualAlertDeduper.shouldEmit(reason, url);
}

async function goToZone(p: Page, zone: string): Promise<boolean> {
  emit({ type: "log", botId: init.botId, message: `no seats; trying next zone ${zone}` });
  emit({ type: "state", botId: init.botId, state: "BOOKING", detail: `Trying zone ${zone}` });

  if (classifyPage(p.url()) === "zones") {
    if (await clickZoneViaMap(p, zone)) return true;
  }

  const zoneUrl = replaceZoneInUrl(p.url(), zone);
  if (zoneUrl) {
    await p.goto(zoneUrl, { waitUntil: "domcontentloaded" });
    return true;
  }

  const selector = init.config.concert.selectors.zone_link.replace("{zone}", zone);
  try {
    await p.locator(selector).first().click({ timeout: 3000 });
    await p.waitForLoadState("domcontentloaded", { timeout: 10000 }).catch(() => undefined);
    return true;
  } catch (error) {
    emit({ type: "log", botId: init.botId, message: `zone ${zone} not clicked: ${errorMessage(error)}` });
    return false;
  }
}

async function clickZoneViaMap(p: Page, zone: string): Promise<boolean> {
  try {
    const clicked = await p.evaluate((zoneCode) => {
      const area = Array.from(document.querySelectorAll<HTMLAreaElement>(".map-zone area[href]"))
        .find((candidate) => candidate.href.endsWith(`#${zoneCode}`) || candidate.getAttribute("href")?.endsWith(`#${zoneCode}`));
      if (!area) return false;

      const event = new MouseEvent("click", { bubbles: true, cancelable: true, view: window, button: 0 });
      const selectZone = (window as typeof window & {
        selectzone?: (href: string, event: MouseEvent) => void;
      }).selectzone;
      if (typeof selectZone === "function") {
        selectZone(area.href, event);
        return true;
      }

      area.dispatchEvent(event);
      return true;
    }, zone);
    if (!clicked) return false;
    if (await waitForFixedPageNavigation(p, 18000)) return true;
    throw new Error("fixed page navigation not reached");
  } catch (error) {
    emit({ type: "log", botId: init.botId, message: `zone ${zone} map click failed: ${errorMessage(error)}` });
    return false;
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
  forensicEvent("error", "thrown", {
    error: errorMessage(error),
    stack: error instanceof Error ? error.stack : undefined,
  });
  emit({ type: "error", botId: init.botId, message: errorMessage(error), stack: error instanceof Error ? error.stack : undefined });
  emit({ type: "state", botId: init.botId, state: "ERROR", detail: errorMessage(error) });
}

async function captureDecision(label: string): Promise<void> {
  if (!forensics || !page) return;
  await forensics.captureDecision(init.botId, page, label);
}

function forensicEvent(action: string, result: string, extra: Record<string, unknown> = {}): void {
  forensics?.event({
    botId: init.botId,
    state: snapshotsStateSafe(),
    url: page?.url(),
    pageKind: page ? classifyPage(page.url()) : undefined,
    action,
    result,
    ...extra,
  });
}

function snapshotsStateSafe(): string {
  return "worker";
}

function resolveArtifactRoot(rootDir: string, artifactRoot: string): string {
  const resolvedRoot = path.resolve(rootDir);
  const resolvedArtifactRoot = path.resolve(resolvedRoot, artifactRoot);
  if (resolvedArtifactRoot !== resolvedRoot && !resolvedArtifactRoot.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error(`Invalid artifact_root: ${artifactRoot}`);
  }
  return resolvedArtifactRoot;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function escapeCssAttributeValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function replaceZoneInUrl(url: string, zone: string): string | undefined {
  try {
    const parsed = new URL(url);
    if (!parsed.searchParams.has("zone")) return undefined;
    parsed.searchParams.set("zone", zone);
    return parsed.toString();
  } catch {
    return undefined;
  }
}
