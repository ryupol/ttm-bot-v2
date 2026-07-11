import type { MessagePort } from "node:worker_threads";
import type { Page } from "playwright";
import type { BotCommand, BotEvent, WorkerInit } from "../../ipc/types.ts";
import { AccessBlockTracker } from "../auth/AccessBlockTracker.ts";
import { LoginService } from "../auth/LoginService.ts";
import { BookingService } from "../booking/BookingService.ts";
import { BrowserSession } from "../browser/BrowserSession.ts";
import { ManualInterventionService } from "../manual/ManualInterventionService.ts";
import { ForensicReporter } from "../observability/ForensicReporter.ts";
import { createNotifierFromEnv } from "../observability/Notifier.ts";
import { QueueAcquisitionService } from "../queue/QueueAcquisitionService.ts";
import { QueueHoldingService } from "../queue/QueueHoldingService.ts";
import { classifyCurrentPage, type PageKind } from "../routing/PageClassifier.ts";
import { commandFlowForPage } from "../routing/PageFlowPolicy.ts";
import { PageRouter } from "../routing/PageRouter.ts";
import { PageStatusReporter } from "../routing/PageStatusReporter.ts";
import { VerificationService } from "../verification/VerificationService.ts";
import { errorMessage } from "../../utils/errors.ts";

export function createBotRuntime(init: WorkerInit, port: MessagePort): BotRuntime {
  return new BotRuntime(init, port);
}

class BotRuntime {
  private readonly session: BrowserSession;
  private readonly accessBlocks: AccessBlockTracker;
  private readonly booking: BookingService;
  private readonly forensics: ForensicReporter;
  private readonly init: WorkerInit;
  private readonly loginService: LoginService;
  private readonly manualIntervention: ManualInterventionService;
  private readonly pageRouter: PageRouter;
  private readonly pageStatusReporter: PageStatusReporter;
  private readonly port: MessagePort;
  private readonly queueAcquisition: QueueAcquisitionService;
  private readonly queueHolding: QueueHoldingService;
  private readonly verification: VerificationService;
  private stopped = false;
  private runningCommand: BotCommand["type"] | undefined;
  private readonly notifier: ReturnType<typeof createNotifierFromEnv>;

  constructor(init: WorkerInit, port: MessagePort) {
    this.init = init;
    this.port = port;
    this.notifier = createNotifierFromEnv(this.init.config.settings);
    this.accessBlocks = new AccessBlockTracker({
      botId: this.init.botId,
      emit: this.emit.bind(this),
    });
    this.session = new BrowserSession({
      rootDir: this.init.config.rootDir,
      botId: this.init.botId,
      totalBots: this.init.totalBots,
      settings: this.init.config.settings,
      onResponse: (response) => this.handleResponse(response),
      onLog: (message) => this.emit({ type: "log", botId: this.init.botId, message }),
    });
    this.forensics = new ForensicReporter(this.init, () => this.session.getPage());
    this.manualIntervention = new ManualInterventionService({
      botId: this.init.botId,
      notifier: this.notifier,
      emit: this.emit.bind(this),
      getPage: () => this.session.getPage(),
      shouldStop: () => this.stopped,
      resume: () => this.handleCurrentPage(),
      forensics: this.forensics.callbacks(),
    });
    this.booking = new BookingService({
      botId: this.init.botId,
      concert: this.init.config.concert,
      emit: this.emit.bind(this),
      emitDone: this.emitDone.bind(this),
      notify: this.notifyBestEffort.bind(this),
      handleCurrentPage: () => this.handleCurrentPage(),
      shouldStop: () => this.stopped,
      forensics: this.forensics.callbacks(),
    });
    this.loginService = new LoginService({
      botId: this.init.botId,
      concert: this.init.config.concert,
      account: this.init.account,
      emit: this.emit.bind(this),
      emitDoneIfTerminal: this.emitDoneIfTerminal.bind(this),
      emitRecentAccessBlock: () => this.accessBlocks.emitRecent(),
      clearAccessBlockAfterSuccessfulLogin: () => this.accessBlocks.clearAfterSuccessfulLogin(),
      emitManual: this.emitManual.bind(this),
    });
    this.pageStatusReporter = new PageStatusReporter({
      botId: this.init.botId,
      emit: this.emit.bind(this),
      getPage: () => this.requirePage(),
      shouldStop: () => this.stopped,
      emitRecentAccessBlock: () => this.accessBlocks.emitRecent(),
      emitDone: this.emitDone.bind(this),
    });
    this.queueHolding = new QueueHoldingService({
      botId: this.init.botId,
      concert: this.init.config.concert,
      notifier: this.notifier,
      emit: this.emit.bind(this),
      shouldStop: () => this.stopped,
      shouldEmitManualAlert: this.shouldEmitManualAlert.bind(this),
      handleCurrentPage: () => this.handleCurrentPage(),
      forensics: this.forensics.callbacks(),
    });
    this.queueAcquisition = new QueueAcquisitionService({
      botId: this.init.botId,
      concert: this.init.config.concert,
      emit: this.emit.bind(this),
      shouldStop: () => this.stopped,
      emitManual: this.emitManual.bind(this),
      waitForManualClearThenResume: this.waitForManualClearThenResume.bind(this),
      holdQueue: (page) => this.queueHolding.hold(page),
      handleCurrentPage: () => this.handleCurrentPage(),
      forensics: this.forensics.callbacks(),
    });
    this.verification = new VerificationService({
      botId: this.init.botId,
      account: this.init.account,
      emit: this.emit.bind(this),
      emitManual: this.emitManual.bind(this),
      waitForManualClearThenResume: this.waitForManualClearThenResume.bind(this),
      handleCurrentPage: () => this.handleCurrentPage(),
      forensics: this.forensics.callbacks(),
    });
    this.pageRouter = new PageRouter({
      botId: this.init.botId,
      getPage: () => this.requirePage(),
      shouldStop: () => this.stopped,
      manualSolveTimeoutSeconds: this.init.config.settings.manual_solve_timeout,
      emit: this.emit.bind(this),
      emitManual: this.emitManual.bind(this),
      waitForManualClearThenResume: this.waitForManualClearThenResume.bind(this),
      emitDone: this.emitDone.bind(this),
      queueHolding: this.queueHolding,
      booking: this.booking,
      verification: this.verification,
      forensics: this.forensics,
    });
  }

  async start(): Promise<void> {
    this.port.on("message", (command: BotCommand) => {
      void this.handleCommand(command);
    });

    try {
      this.forensics.initialize();
      await this.launch();
      this.emit({ type: "state", botId: this.init.botId, state: "IDLE", detail: "Auto login starting" });
      this.emit({ type: "log", botId: this.init.botId, message: "browser opened; auto login will run, submit manually if needed, then go all" });
    } catch (error) {
      this.emitError(error);
    }
  }

  private async handleCommand(command: BotCommand): Promise<void> {
    try {
      if (command.type === "stop") {
        this.stopped = true;
        this.emit({ type: "state", botId: this.init.botId, state: "STOPPED", detail: "Stopped by user" });
        return;
      }

      if (command.type === "shutdown") {
        this.stopped = true;
        this.emit({ type: "state", botId: this.init.botId, state: "STOPPED", detail: "Shutting down" });
        await this.session.close();
        process.exit(0);
      }

      if (command.type === "set_zone_priority") {
        this.booking.setZonePriority(command.zones);
        return;
      }

      if (this.runningCommand) {
        this.emit({ type: "log", botId: this.init.botId, message: `command ${command.type} ignored: ${this.runningCommand} still running (use stop first)` });
        return;
      }
      this.runningCommand = command.type;
      // check is read-only; it must not cancel an in-flight stop
      if (command.type !== "check") this.stopped = false;
      if (!this.session.getPage()) await this.launch();

      if (command.type === "login") await this.loginService.login(this.requirePage());
      else if (command.type === "check") await this.checkStatus();
      else if (command.type === "go") await this.go(command.scheduledFor);
      else if (command.type === "reset") await this.reset();
      else this.emit({ type: "log", botId: this.init.botId, message: `unknown command ignored: ${(command as { type: string }).type}` });
    } catch (error) {
      this.emitError(error);
    } finally {
      if (command.type !== "stop" && command.type !== "shutdown") this.runningCommand = undefined;
    }
  }

  private async launch(): Promise<void> {
    const page = await this.session.launch();
    this.forensics.attachToPage(page);
  }

  private handleResponse(response: { status(): number; url(): string; request(): { resourceType(): string } }): void {
    this.accessBlocks.handleResponse(response);
  }

  private async emitDoneIfTerminal(p: Page, logMessage: string): Promise<boolean> {
    const kind = await classifyCurrentPage(p);
    if (kind !== "payment" && kind !== "enroll") return false;
    this.emitDone(kind);
    this.emit({ type: "log", botId: this.init.botId, message: logMessage });
    return true;
  }

  private emitDone(kind: PageKind): void {
    const detail = kind === "enroll" ? "Enroll page" : "Payment page";
    this.forensics.event("booking", kind === "enroll" ? "enroll-page" : "payment-page");
    this.emit({ type: "state", botId: this.init.botId, state: "DONE", detail });
  }

  private async go(scheduledFor?: string): Promise<void> {
    const p = this.requirePage();
    const kind = await classifyCurrentPage(p);
    if (await this.emitDoneIfTerminal(p, "already done")) return;
    if (kind === "login") {
      await this.loginService.openAndFillLoginForm(p);
      return;
    }
    if (commandFlowForPage(kind) === "resume") {
      this.emit({ type: "log", botId: this.init.botId, message: `go resumes current page: ${kind} ${p.url()}` });
      await this.handleCurrentPage();
      return;
    }
    await this.queueAcquisition.run(p, scheduledFor ? `Started by timer ${scheduledFor}` : "Started manually");
  }

  private async checkStatus(): Promise<void> {
    await this.pageStatusReporter.check();
  }

  private async reset(): Promise<void> {
    this.stopped = false;
    const p = this.requirePage();
    await p.goto(this.init.config.settings.base_url, { waitUntil: "domcontentloaded" });
    this.emit({ type: "state", botId: this.init.botId, state: "IDLE", detail: "Reset; manual login" });
  }

  private async handleCurrentPage(options: { waitForFixed?: boolean } = {}): Promise<void> {
    await this.pageRouter.handleCurrentPage(options);
  }

  private async notifyBestEffort(message: string): Promise<void> {
    try {
      await this.notifier.send(message);
    } catch (error) {
      this.emit({ type: "log", botId: this.init.botId, message: `telegram failed: ${errorMessage(error)}` });
    }
  }

  private async emitManual(reason: string, captureLabel = "manual-intervention-appears", detail?: string, userMessage?: string): Promise<void> {
    await this.manualIntervention.emit(reason, captureLabel, detail, userMessage);
  }

  private async waitForManualClearThenResume(p: Page): Promise<void> {
    await this.manualIntervention.waitForClearThenResume(p);
  }

  private shouldEmitManualAlert(reason: string, url: string): boolean {
    return this.manualIntervention.shouldEmitAlert(reason, url);
  }

  private requirePage(): Page {
    return this.session.requirePage();
  }

  private emit(event: BotEvent): void {
    this.port.postMessage(event);
  }

  private emitError(error: unknown): void {
    this.forensics.error(error);
    this.emit({ type: "error", botId: this.init.botId, message: errorMessage(error), stack: error instanceof Error ? error.stack : undefined });
    this.emit({ type: "state", botId: this.init.botId, state: "ERROR", detail: errorMessage(error) });
  }
}
