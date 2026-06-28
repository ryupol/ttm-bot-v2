import type { PageKind } from "./pages/classifier.ts";

export type CommandFlow = "acquire" | "resume";

const RESUMABLE_PAGE_KINDS = new Set<PageKind>([
  "queue",
  "zones",
  "fixed",
  "payment",
  "enroll",
  "verify",
  "verify_condition",
  "unknown",
]);

export function commandFlowForPage(pageKind: PageKind): CommandFlow {
  return RESUMABLE_PAGE_KINDS.has(pageKind) ? "resume" : "acquire";
}

export function zoneFromUrl(url: string): string | undefined {
  try {
    const parsed = new URL(url);
    return parsed.searchParams.get("zone") ?? undefined;
  } catch {
    return undefined;
  }
}

type UrlWaiter = {
  url: () => string;
  waitForURL: (predicate: (url: URL) => boolean, options: { timeout: number }) => Promise<unknown>;
};

export async function waitForFixedPageNavigation(page: UrlWaiter, timeout: number, pollMs = 50): Promise<boolean> {
  try {
    await page.waitForURL((url) => url.toString().includes("fixed.php"), { timeout });
    return true;
  } catch {
    const deadline = Date.now() + timeout;
    while (Date.now() <= deadline) {
      if (page.url().includes("fixed.php")) return true;
      await sleep(pollMs);
    }
    return false;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
