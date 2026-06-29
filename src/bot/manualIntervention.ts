import type { Page } from "playwright";
import type {
  ManualInterventionReason,
  ManualInterventionState,
  ManualInterventionTransition,
} from "./models/ManualIntervention.ts";
import { matchSignatures } from "./pages/signatures.ts";

const YZ_IMAGE_CLASS_PATTERN = /<img\b[^>]*\bclass\s*=\s*["'][^"']*\byz\b[^"']*["'][^>]*>/i;
const TERMS_CONTROL_PATTERN = /<[^>]*(?:btn_confirmpolicy|rdagree)[^>]*>/gi;
const HIDDEN_CONTROL_PATTERN = /\bhidden\b|display\s*:\s*none|visibility\s*:\s*hidden|\btype\s*=\s*["']?hidden["']?/i;
const TEMPLATE_PATTERN = /<template\b[^>]*>[\s\S]*?<\/template>/gi;

function hasVisibleTermsControl(html: string): boolean {
  const tags = html.replace(TEMPLATE_PATTERN, "").match(TERMS_CONTROL_PATTERN) ?? [];
  return tags.some((tag) => !HIDDEN_CONTROL_PATTERN.test(tag));
}

export function classifyManualIntervention(input: { url: string; html: string }): ManualInterventionState {
  const url = input.url.toLowerCase();
  const html = input.html.toLowerCase();
  if (isHttpBlockPage(url, html, "428")) {
    return manual("too_many_requests", "428", "Access blocked: 428");
  }
  if (isForbiddenPage(url, html)) {
    return manual("forbidden", "403", "Access blocked: 403");
  }
  if (url.includes("signin.php") || url.includes("/user/login")) {
    const detail = html.includes("turnstile") || html.includes("cf-turnstile")
      ? "login page with Turnstile"
      : "login page";
    return manual("login", detail, "Login required");
  }
  for (const match of matchSignatures(input)) {
    if (match.signature.manualReason === "captcha") {
      return manual("captcha", match.signature.id, "Human check required");
    }
  }
  if (
    url.includes("captcha") ||
    html.includes('class="yz"') ||
    YZ_IMAGE_CLASS_PATTERN.test(input.html) ||
    html.includes("_captcha") ||
    html.includes("challenges.cloudflare.com") ||
    html.includes("cf-turnstile") ||
    html.includes("geetest") ||
    html.includes("puzzle-slider")
  ) {
    return manual("captcha", describePage(input.url), "Human check required");
  }
  if (url.includes("verify.php") || url.includes("verify_condition.php")) {
    return manual("verify", describePage(input.url), "Verification required");
  }
  if (hasVisibleTermsControl(input.html)) {
    return manual("terms", describePage(input.url), "Terms confirmation required");
  }
  return { present: false };
}

function isHttpBlockPage(url: string, html: string, code: string): boolean {
  return url.includes(code) || html.includes(`${code} `) || html.includes(`>${code}<`);
}

export function classifyUnknownManualPage(input: { url: string; knownPage: boolean }): ManualInterventionState {
  if (!input.knownPage) {
    const detail = describePage(input.url);
    return manual("unknown_page", detail, `Stuck at ${detail}`);
  }
  return { present: false };
}

function manual(reason: ManualInterventionReason, detail: string | undefined, userMessage: string): ManualInterventionState {
  return { present: true, reason, detail, userMessage };
}

function isForbiddenPage(url: string, html: string): boolean {
  return url.includes("403") ||
    html.includes("403 forbidden") ||
    html.includes("access denied") ||
    html.includes("request blocked") ||
    html.includes("akamai") && html.includes("reference #");
}

function describePage(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.host}${parsed.pathname}`;
  } catch {
    return url;
  }
}

export async function detectManualInterventionOnPage(page: Page): Promise<ManualInterventionState> {
  const url = page.url();
  const html = await page.content().catch(() => "");
  return classifyManualIntervention({ url, html });
}

export function transitionManualIntervention(
  previousVisible: boolean,
  currentVisible: boolean,
): ManualInterventionTransition {
  if (!previousVisible && currentVisible) return "appeared";
  if (previousVisible && !currentVisible) return "cleared";
  return "unchanged";
}
