import type { Page } from "playwright";
import { detectManualInterventionOnPage } from "./ManualIntervention.ts";
import { classifyPage } from "../routing/PageClassifier.ts";

export type ManualRecoveryResult = "cleared" | "stopped";

export async function waitForManualInterventionToClear(
  page: Pick<Page, "url" | "content" | "waitForTimeout">,
  options: {
    shouldStop: () => boolean;
    pollMs?: number;
    onCleared?: () => void | Promise<void>;
  },
): Promise<ManualRecoveryResult> {
  const pollMs = options.pollMs ?? 1000;
  let sawNonRoutableManual = false;

  while (!options.shouldStop()) {
    const routable = isRoutablePage(page.url());
    if (sawNonRoutableManual && routable) {
      await options.onCleared?.();
      return "cleared";
    }
    const manual = await detectManualInterventionOnPage(page as Page);
    if (!manual.present) {
      await options.onCleared?.();
      return "cleared";
    }
    if (!routable) sawNonRoutableManual = true;
    await page.waitForTimeout(pollMs);
  }

  return "stopped";
}

function isRoutablePage(url: string): boolean {
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
