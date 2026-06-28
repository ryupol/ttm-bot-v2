import type { Page } from "playwright";
import { detectManualInterventionOnPage } from "./manualIntervention.ts";

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

  while (!options.shouldStop()) {
    const manual = await detectManualInterventionOnPage(page as Page);
    if (!manual.present) {
      await options.onCleared?.();
      return "cleared";
    }
    await page.waitForTimeout(pollMs);
  }

  return "stopped";
}
