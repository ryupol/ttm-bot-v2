import type { Page } from "playwright";
import type { ResolvedAccount } from "../../config/schema.ts";
import type { VerifyConditionResult, VerifyResult } from "../models/Verification.ts";

type VerifyPage = Pick<Page, "url" | "locator" | "waitForURL" | "waitForLoadState">;
type VerifyConditionPage = Pick<Page, "url" | "locator" | "evaluate" | "waitForURL" | "waitForLoadState">;

export async function submitThaiCitizenId(page: VerifyPage, account: ResolvedAccount, maxAttempts = 3): Promise<VerifyResult> {
  if (!page.url().includes("verify.php")) return { status: "not_verify_page" };
  const citizenId = account.citizenId?.trim();
  if (!citizenId) return { status: "missing_citizen_id" };

  let lastError: string | undefined;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await page.locator("button.verify-method-btn[data-method='thaiid']").first().click({ timeout: 10000 });
      const input = page.locator("input#txt_verifycode").first();
      await input.waitFor({ state: "visible", timeout: 5000 });
      await input.fill("");
      await input.fill(citizenId);
      await page.locator("button#btnconfirm").first().click({ timeout: 5000 });
      const passed = await waitForUrlToLeave(page, "verify.php", 10000);
      if (passed) return { status: "passed" };
      lastError = "still on verify page after submit";
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
  }

  return { status: "failed", error: lastError };
}

export async function submitVerifyCondition(page: VerifyConditionPage): Promise<VerifyConditionResult> {
  if (!page.url().includes("verify_condition.php")) return { status: "not_verify_condition_page" };

  await tickTermsControls(page);
  const confirm = page.locator(CONFIRM_SELECTORS.join(", ")).first();
  const visible = await confirm.isVisible({ timeout: 1000 }).catch(() => false);
  if (!visible) return { status: "confirm_not_found" };

  await confirm.click({ timeout: 5000 });
  await page.waitForURL((url) => !url.toString().includes("verify_condition.php"), { timeout: 10000 }).catch(() => undefined);
  await page.waitForLoadState("domcontentloaded", { timeout: 5000 }).catch(() => undefined);
  return { status: "submitted" };
}

const CONFIRM_SELECTORS = [
  "button#btn_verify",
  "button.btn-solid-round5-blue[data-query]",
  "button.btn-red.btn-signin-confirm",
  "button#btn_confirmpolicy",
  "button.btn-red",
  "a.btn-red",
  "button[type='submit']",
  "input[type='submit']",
];

async function tickTermsControls(page: VerifyConditionPage): Promise<void> {
  await page.evaluate(() => {
    const agree = document.querySelector<HTMLInputElement>("#rdagree, input[name='rdagree']");
    if (agree) {
      agree.checked = true;
      agree.dispatchEvent(new Event("change", { bubbles: true }));
    }

    document.querySelectorAll<HTMLInputElement>("input[type='checkbox']").forEach((checkbox) => {
      if (!checkbox.checked && checkbox.offsetParent !== null) {
        checkbox.checked = true;
        checkbox.dispatchEvent(new Event("change", { bubbles: true }));
      }
    });
  }).catch(() => undefined);
}

async function waitForUrlToLeave(page: VerifyPage, path: string, timeout: number): Promise<boolean> {
  await page.waitForURL((url) => !url.toString().includes(path), { timeout }).catch(() => undefined);
  await page.waitForLoadState("domcontentloaded", { timeout: 5000 }).catch(() => undefined);
  return !page.url().includes(path);
}
