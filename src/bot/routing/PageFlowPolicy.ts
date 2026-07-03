import type { PageKind } from "./PageClassifier.ts";

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

export class PageFlowPolicy {
  private readonly resumablePageKinds: ReadonlySet<PageKind>;

  constructor(resumablePageKinds: ReadonlySet<PageKind> = RESUMABLE_PAGE_KINDS) {
    this.resumablePageKinds = resumablePageKinds;
  }

  commandFlowForPage(pageKind: PageKind): CommandFlow {
    return this.resumablePageKinds.has(pageKind) ? "resume" : "acquire";
  }

  zoneFromUrl(url: string): string | undefined {
    try {
      const parsed = new URL(url);
      return parsed.searchParams.get("zone") ?? undefined;
    } catch {
      return undefined;
    }
  }

  async waitForFixedPageNavigation(page: UrlWaiter, timeout: number, pollMs = 50): Promise<boolean> {
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
}

const DEFAULT_PAGE_FLOW_POLICY = new PageFlowPolicy();

export function commandFlowForPage(pageKind: PageKind): CommandFlow {
  return DEFAULT_PAGE_FLOW_POLICY.commandFlowForPage(pageKind);
}

export function zoneFromUrl(url: string): string | undefined {
  return DEFAULT_PAGE_FLOW_POLICY.zoneFromUrl(url);
}

type UrlWaiter = {
  url: () => string;
  waitForURL: (predicate: (url: URL) => boolean, options: { timeout: number }) => Promise<unknown>;
};

export async function waitForFixedPageNavigation(page: UrlWaiter, timeout: number, pollMs = 50): Promise<boolean> {
  return DEFAULT_PAGE_FLOW_POLICY.waitForFixedPageNavigation(page, timeout, pollMs);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
