import type { Page } from "playwright";
import type { ResolvedAccount } from "../../config/schema.ts";
import type { BotEvent } from "../../ipc/types.ts";
import type { ForensicCallbacks } from "../observability/ForensicReporter.ts";
import { submitThaiCitizenId, submitVerifyCondition } from "./VerifyPage.ts";

export type VerificationServiceOptions = {
  botId: number;
  account: ResolvedAccount;
  emit: (event: BotEvent) => void;
  emitManual: (reason: string, captureLabel: string, detail?: string, userMessage?: string) => Promise<void>;
  waitForManualClearThenResume: (page: Page) => Promise<void>;
  handleCurrentPage: () => Promise<void>;
  forensics: ForensicCallbacks;
};

export class VerificationService {
  private readonly options: VerificationServiceOptions;

  constructor(options: VerificationServiceOptions) {
    this.options = options;
  }

  async submitCitizenId(page: Page): Promise<void> {
    this.options.emit({ type: "state", botId: this.options.botId, state: "BOOKING", detail: "Submitting citizen ID" });
    await this.options.forensics.captureDecision("before-verify-submit");
    this.options.forensics.event("verify", "start");
    const result = await submitThaiCitizenId(page, this.options.account);
    await this.options.forensics.captureDecision("after-verify-submit");
    this.options.forensics.event("verify", result.status, "error" in result ? { error: result.error } : {});

    if (result.status === "passed") {
      this.options.emit({ type: "log", botId: this.options.botId, message: "citizen ID verify passed" });
      await this.options.handleCurrentPage();
      return;
    }
    if (result.status === "missing_citizen_id") {
      await this.options.emitManual("verify", "manual-intervention-appears", "missing citizen_id", "Verification required");
      return;
    }
    await this.options.emitManual("verify", "manual-intervention-appears", "citizen ID verify failed", "Verification required");
    await this.options.waitForManualClearThenResume(page);
  }

  async submitTerms(page: Page): Promise<void> {
    this.options.emit({ type: "state", botId: this.options.botId, state: "BOOKING", detail: "Confirming terms" });
    await this.options.forensics.captureDecision("before-verify-condition-submit");
    this.options.forensics.event("verify-condition", "start");
    const result = await submitVerifyCondition(page);
    await this.options.forensics.captureDecision("after-verify-condition-submit");
    this.options.forensics.event("verify-condition", result.status);

    if (result.status === "submitted") {
      this.options.emit({ type: "log", botId: this.options.botId, message: "verify condition submitted" });
      await this.options.handleCurrentPage();
      return;
    }
    await this.options.emitManual("terms", "manual-intervention-appears", "confirm button not found", "Terms confirmation required");
    await this.options.waitForManualClearThenResume(page);
  }
}
