import path from "node:path";
import { chromium, type BrowserContext, type Page, type Response } from "playwright";
import type { Settings } from "../../config/schema.ts";
import { tileBrowserWindow } from "./WindowLayoutManager.ts";

export type BrowserSessionOptions = {
  rootDir: string;
  botId: number;
  totalBots: number;
  settings: Settings;
  onResponse?: (response: Response) => void;
  onLog?: (message: string) => void;
};

export class BrowserSession {
  private context: BrowserContext | undefined;
  private readonly options: BrowserSessionOptions;
  private page: Page | undefined;

  constructor(options: BrowserSessionOptions) {
    this.options = options;
  }

  async launch(): Promise<Page> {
    const profileDir = path.join(this.options.rootDir, "bot_data", `worker_${this.options.botId}`);
    this.context = await chromium.launchPersistentContext(profileDir, {
      headless: this.options.settings.headless,
      channel: this.options.settings.browser.channel,
      viewport: null,
      args: ["--disable-blink-features=AutomationControlled"],
    });

    const oldPages = this.context.pages();
    this.page = await this.context.newPage();
    await Promise.all(oldPages.map((oldPage) => oldPage.close().catch(() => undefined)));
    if (this.options.onResponse) this.page.on("response", this.options.onResponse);

    await this.page.goto(this.options.settings.base_url, { waitUntil: "domcontentloaded" }).catch((error) => {
      this.options.onLog?.(`initial page load skipped: ${errorMessage(error)}`);
    });
    try {
      await tileBrowserWindow(this.context, this.options.botId - 1, this.options.totalBots, this.options.settings);
    } catch (error) {
      this.options.onLog?.(`window tiling skipped: ${errorMessage(error)}`);
    }

    return this.page;
  }

  async close(): Promise<void> {
    await this.context?.close().catch(() => undefined);
  }

  getPage(): Page | undefined {
    return this.page;
  }

  requirePage(): Page {
    if (!this.page) throw new Error("browser page not ready");
    return this.page;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
