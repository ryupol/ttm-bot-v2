import type { Page } from "playwright";
import type { Concert, ResolvedAccount } from "../../config/schema.ts";
import type { BotEvent } from "../../ipc/types.ts";
import { detectManualInterventionOnPage } from "../manual/ManualIntervention.ts";
import { hasLoggedInMarker } from "./SessionMarkers.ts";

export type LoginServiceOptions = {
  botId: number;
  concert: Concert;
  account: ResolvedAccount;
  emit: (event: BotEvent) => void;
  emitDoneIfTerminal: (page: Page, logMessage: string) => Promise<boolean>;
  emitRecentAccessBlock: () => boolean;
  clearAccessBlockAfterSuccessfulLogin: () => void;
  emitManual: (reason: string, captureLabel: string, detail?: string, userMessage?: string) => Promise<void>;
};

export class LoginService {
  private readonly options: LoginServiceOptions;

  constructor(options: LoginServiceOptions) {
    this.options = options;
  }

  async login(p: Page): Promise<void> {
    if (await this.options.emitDoneIfTerminal(p, "login skipped")) return;
    await p.goto(this.options.concert.event_url, { waitUntil: "domcontentloaded" });
    this.options.emitRecentAccessBlock();
    if (await this.isLoggedIn(p)) {
      this.options.clearAccessBlockAfterSuccessfulLogin();
      this.options.emit({ type: "state", botId: this.options.botId, state: "READY", detail: "Logged in" });
      this.options.emit({ type: "log", botId: this.options.botId, message: "already logged in" });
      return;
    }

    await this.openAndFillLoginForm(p);
  }

  async openAndFillLoginForm(p: Page): Promise<void> {
    if (await this.options.emitDoneIfTerminal(p, "login skipped")) return;
    await p.goto("https://event.thaiticketmajor.com/user/signin.php?redir=/concert/", { waitUntil: "domcontentloaded" });
    this.options.emitRecentAccessBlock();
    const manual = await detectManualInterventionOnPage(p);
    if (manual.present && manual.reason !== "login") {
      await this.options.emitManual(manual.reason, "manual-intervention-appears", manual.detail, manual.userMessage);
      return;
    }

    const email = this.options.account.email?.trim() ?? "";
    const password = this.options.account.password?.trim() ?? "";
    if (!email || !password) {
      this.options.emit({ type: "state", botId: this.options.botId, state: "MANUAL_INTERVENTION", detail: "Login required" });
      this.options.emit({ type: "log", botId: this.options.botId, message: "login required" });
      return;
    }

    const username = p.locator("#frm-signin-page input[name='username']").first();
    const pass = p.locator("#frm-signin-page input[name='password']").first();
    try {
      await username.waitFor({ state: "visible", timeout: 8000 });
      if (await username.inputValue().catch(() => "") !== email) await username.fill(email);
      if (await pass.inputValue().catch(() => "") !== password) await pass.fill(password);
      this.options.emit({ type: "log", botId: this.options.botId, message: "login form filled" });
    } catch {
      this.options.emit({ type: "log", botId: this.options.botId, message: "login required" });
    }
    this.options.emit({ type: "state", botId: this.options.botId, state: "MANUAL_INTERVENTION", detail: "Login required" });
  }

  private async isLoggedIn(p: Page): Promise<boolean> {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      await p.waitForTimeout(1000);
      const html = await p.content().catch(() => "");
      if (hasLoggedInMarker(html)) return true;
    }
    return false;
  }
}
