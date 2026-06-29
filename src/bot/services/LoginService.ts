import type { Locator, Page } from "playwright";
import type { Concert, ResolvedAccount } from "../../config/schema.ts";
import type { BotEvent } from "../../ipc/types.ts";
import { detectManualInterventionOnPage } from "../manualIntervention.ts";
import { hasLoggedInMarker } from "../session.ts";
import { resolveTargetRoundOnPage } from "../targetRound.ts";

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
      this.options.emit({ type: "log", botId: this.options.botId, message: `login credentials missing: ${missingCredentialLabels(this.options.account)}` });
      return;
    }

    try {
      const form = await findVisibleLoginForm(p);
      const username = form.locator("input[name='username'], input[type='email']").first();
      const pass = form.locator("input[name='password'], input[type='password']").first();
      await username.waitFor({ state: "visible", timeout: 8000 });
      await pass.waitFor({ state: "visible", timeout: 8000 });
      if (await username.inputValue().catch(() => "") !== email) await username.fill(email);
      if (await pass.inputValue().catch(() => "") !== password) await pass.fill(password);
      this.options.emit({ type: "log", botId: this.options.botId, message: "login form filled" });
    } catch (error) {
      this.options.emit({ type: "log", botId: this.options.botId, message: `login form not filled: ${errorMessage(error)}` });
    }
    this.options.emit({ type: "state", botId: this.options.botId, state: "MANUAL_INTERVENTION", detail: "Login required" });
  }

  private async isLoggedIn(p: Page): Promise<boolean> {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      await p.waitForTimeout(1000);
      const html = await p.content().catch(() => "");
      if (await this.targetRoundStillRequiresLogin(p)) return false;
      if (hasLoggedInMarker(html)) return true;
    }
    return false;
  }

  private async targetRoundStillRequiresLogin(p: Page): Promise<boolean> {
    const targetRound = this.options.concert.target_round;
    if (!targetRound) return false;
    const target = await resolveTargetRoundOnPage(p, targetRound).catch(() => undefined);
    return target?.requiresLogin ?? false;
  }
}

async function findVisibleLoginForm(page: Page): Promise<Locator> {
  for (const selector of ["#frm-signin-page", "#frm-signin"]) {
    const form = page.locator(selector).first();
    if (await form.isVisible({ timeout: 1500 }).catch(() => false)) return form;
  }
  throw new Error("visible login form not found");
}

function missingCredentialLabels(account: ResolvedAccount): string {
  const missing: string[] = [];
  if (!account.email?.trim()) missing.push(account.email_env ?? "email");
  if (!account.password?.trim()) missing.push(account.pass_env ?? "password");
  return missing.join(", ");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
