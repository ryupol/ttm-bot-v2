import path from "node:path";
import type { Page } from "playwright";
import type { WorkerInit } from "../../ipc/types.ts";
import { attachForensicListeners, createRunForensics, type RunForensics } from "../forensics.ts";
import { classifyPage } from "../pages/classifier.ts";

export type ForensicCallbacks = {
  captureDecision: (label: string) => Promise<void>;
  event: (action: string, result: string, extra?: Record<string, unknown>) => void;
};

export class ForensicReporter {
  private readonly getPage: () => Page | undefined;
  private readonly init: WorkerInit;
  private run: RunForensics | undefined;
  private readonly listenerPages = new WeakSet<Page>();

  constructor(init: WorkerInit, getPage: () => Page | undefined) {
    this.init = init;
    this.getPage = getPage;
  }

  initialize(): void {
    if (this.run) return;
    const observability = this.init.config.concert.observability;
    if (observability.mode !== "forensic" || !this.init.runId) return;

    this.run = createRunForensics({
      artifactRoot: resolveArtifactRoot(this.init.config.rootDir, observability.artifact_root),
      runId: this.init.runId,
      botCount: this.init.totalBots,
      targetRound: this.init.config.concert.target_round,
      queueStart: this.init.config.concert.queue_start,
      saleStart: this.init.config.concert.sale_start,
      captureHtml: observability.capture_html,
      captureScreenshot: observability.capture_screenshot,
      captureNetworkFailures: observability.capture_network_failures,
      captureConsoleErrors: observability.capture_console_errors,
    });
  }

  callbacks(): ForensicCallbacks {
    return {
      captureDecision: this.captureDecision.bind(this),
      event: this.event.bind(this),
    };
  }

  attachToPage(page: Page): void {
    if (!this.run || this.listenerPages.has(page)) return;
    attachForensicListeners(page, this.run, this.init.botId);
    this.listenerPages.add(page);
  }

  async captureDecision(label: string): Promise<void> {
    const page = this.getPage();
    if (!this.run || !page) return;
    await this.run.captureDecision(this.init.botId, page, label);
  }

  event(action: string, result: string, extra: Record<string, unknown> = {}): void {
    const page = this.getPage();
    this.run?.event({
      botId: this.init.botId,
      state: "worker",
      url: page?.url(),
      pageKind: page ? classifyPage(page.url()) : undefined,
      action,
      result,
      ...extra,
    });
  }

  error(error: unknown): void {
    this.event("error", "thrown", {
      error: errorMessage(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
  }
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
