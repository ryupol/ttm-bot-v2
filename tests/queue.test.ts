import type { Page } from "playwright";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Notifier } from "../src/bot/notifier.ts";
import { holdQueue } from "../src/bot/pages/queue.ts";
import type { BotEvent } from "../src/ipc/types.ts";
import type { Concert } from "../src/config/schema.ts";

describe("holdQueue", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("redirect from queue to verify page emits manual intervention without queue exit", async () => {
    vi.useFakeTimers();
    const page = mockPage("https://example.com/queue/wait");
    const notifier = mockNotifier();
    const events: BotEvent[] = [];

    const pending = holdQueue(page, concert(), 7, notifier, (event) => events.push(event));
    await vi.waitFor(() => expect(page.content).toHaveBeenCalledTimes(1));

    page.setUrl("https://example.com/booking/verify.php");
    await vi.advanceTimersByTimeAsync(1200);
    await pending;

    expect(events).toContainEqual({
      type: "state",
      botId: 7,
      state: "MANUAL_INTERVENTION",
      detail: "Verification required",
    });
    expect(events).toContainEqual({
      type: "alert",
      botId: 7,
      kind: "manual_intervention",
      message: "Bot 7: manual intervention (Verification required) - solve in browser",
    });
    expect(events.some((event) => event.type === "alert" && event.kind === "queue_exit")).toBe(false);
    expect(notifier.send).toHaveBeenCalledWith("Bot 7: manual intervention (Verification required) - solve in browser");
  });

  it("configured visible captcha selector emits manual intervention once", async () => {
    vi.useFakeTimers();
    const page = mockPage("https://example.com/queue/wait", {
      visibleSelectors: new Set([".custom-captcha"]),
    });
    const notifier = mockNotifier();
    const events: BotEvent[] = [];

    const pending = holdQueue(page, {
      ...concert(),
      queue_indicators: {
        ...concert().queue_indicators,
        captcha_selector: ".custom-captcha",
      },
    }, 3, notifier, (event) => events.push(event));
    await vi.waitFor(() => expect(page.waitForSelector).toHaveBeenCalledWith(".custom-captcha", {
      timeout: 300,
      state: "visible",
    }));

    await vi.advanceTimersByTimeAsync(1200);
    await vi.advanceTimersByTimeAsync(1200);
    page.setUrl("https://example.com/booking/form");
    await vi.advanceTimersByTimeAsync(1200);
    await pending;

    const alerts = events.filter((event) => event.type === "alert" && event.kind === "manual_intervention");
    expect(alerts).toEqual([{
      type: "alert",
      botId: 3,
      kind: "manual_intervention",
      message: "Bot 3: manual intervention (Human check required) - solve in browser",
    }]);
    expect(events.some((event) => event.type === "alert" && event.kind === "queue_exit")).toBe(false);
    expect(notifier.send).toHaveBeenCalledTimes(1);
    expect(notifier.send).toHaveBeenCalledWith("Bot 3: manual intervention (Human check required) - solve in browser");
  });

  it("redirect to non-queue page with configured captcha selector emits manual intervention without queue exit", async () => {
    vi.useFakeTimers();
    const visibleSelectors = new Set<string>();
    const page = mockPage("https://example.com/queue/wait", { visibleSelectors });
    const notifier = mockNotifier();
    const events: BotEvent[] = [];

    const pending = holdQueue(page, {
      ...concert(),
      queue_indicators: {
        ...concert().queue_indicators,
        captcha_selector: ".post-queue-captcha",
      },
    }, 5, notifier, (event) => events.push(event));
    await vi.waitFor(() => expect(page.content).toHaveBeenCalledTimes(1));

    visibleSelectors.add(".post-queue-captcha");
    page.setUrl("https://example.com/booking/form");
    await vi.advanceTimersByTimeAsync(1200);
    await pending;

    expect(events).toContainEqual({
      type: "state",
      botId: 5,
      state: "MANUAL_INTERVENTION",
      detail: "Human check required",
    });
    expect(events).toContainEqual({
      type: "alert",
      botId: 5,
      kind: "manual_intervention",
      message: "Bot 5: manual intervention (Human check required) - solve in browser",
    });
    expect(events.some((event) => event.type === "alert" && event.kind === "queue_exit")).toBe(false);
    expect(notifier.send).toHaveBeenCalledWith("Bot 5: manual intervention (Human check required) - solve in browser");
  });

  it("emits forensic callbacks for queue manual lifecycle and exit", async () => {
    vi.useFakeTimers();
    const visibleSelectors = new Set([".custom-captcha"]);
    const page = mockPage("https://example.com/queue/wait", { visibleSelectors });
    const notifier = mockNotifier();
    const events: BotEvent[] = [];
    const forensicCaptures: string[] = [];
    const forensicEvents: Array<[string, string]> = [];

    const pending = holdQueue(page, {
      ...concert(),
      queue_indicators: {
        ...concert().queue_indicators,
        captcha_selector: ".custom-captcha",
      },
    }, 2, notifier, (event) => events.push(event), {
      captureDecision: async (label) => {
        forensicCaptures.push(label);
      },
      event: (action, result) => {
        forensicEvents.push([action, result]);
      },
    });
    await vi.waitFor(() => expect(forensicCaptures).toContain("manual-intervention-appears"));

    visibleSelectors.delete(".custom-captcha");
    await vi.advanceTimersByTimeAsync(1200);
    await vi.waitFor(() => expect(forensicCaptures).toContain("manual-intervention-clears"));

    page.setUrl("https://example.com/booking/form");
    await vi.advanceTimersByTimeAsync(1200);
    await pending;

    expect(forensicCaptures).toEqual(["manual-intervention-appears", "manual-intervention-clears", "queue-exit"]);
    expect(forensicEvents).toEqual([
      ["manual-intervention", "appeared"],
      ["manual-intervention", "cleared"],
      ["queue", "exit"],
    ]);
  });

  it("does not time out while page remains queue-like", async () => {
    vi.useFakeTimers();
    const page = mockPage("https://example.com/queue/wait");
    const notifier = mockNotifier();
    let settled = false;

    const pending = holdQueue(page, concert(), 9, notifier, () => undefined);
    pending.finally(() => {
      settled = true;
    });
    await vi.waitFor(() => expect(page.content).toHaveBeenCalledTimes(1));
    await vi.advanceTimersByTimeAsync(5000);

    expect(settled).toBe(false);

    page.setUrl("https://example.com/booking/fixed.php");
    await vi.advanceTimersByTimeAsync(1200);
    await pending;
    expect(settled).toBe(true);
  });

  it("auto-clicks Queue-it visitor presence under queue guards", async () => {
    vi.useFakeTimers();
    const button = mockLocator({ text: "Yes, I'm here" });
    const page = mockPage("https://wait.thaiticketmajor.com/view/?c=ticketmasterasia", {
      html: `
        <script>window.queueViewModel = { customerId: "ticketmasterasia" }</script>
        <h2 id="h2ConfirmVisitorPresence">Still here?</h2>
        <p id="pConfirmVisitorPresence">Please confirm you're still waiting.</p>
        <button id="buttonConfirmVisitorPresence">Yes, I'm here</button>
      `,
      locators: new Map([["#buttonConfirmVisitorPresence", button]]),
    });
    const notifier = mockNotifier();
    const forensicCaptures: string[] = [];
    const forensicEvents: Array<[string, string]> = [];

    const pending = holdQueue(page, concert(), 6, notifier, () => undefined, {
      forensics: {
        captureDecision: async (label) => {
          forensicCaptures.push(label);
        },
        event: (action, result) => {
          forensicEvents.push([action, result]);
        },
      },
    });

    await vi.waitFor(() => expect(button.click).toHaveBeenCalledTimes(1));
    page.setUrl("https://example.com/booking/fixed.php");
    await vi.advanceTimersByTimeAsync(2500);
    await pending;

    expect(forensicCaptures).toContain("queue-presence-confirm-before-click");
    expect(forensicCaptures).toContain("queue-presence-confirm-after-click");
    expect(forensicEvents).toContainEqual(["queue-presence-confirm", "detected"]);
    expect(forensicEvents).toContainEqual(["queue-presence-confirm", "clicked"]);
  });

  it("rate-limits Queue-it visitor presence clicks", async () => {
    vi.useFakeTimers();
    const button = mockLocator({ text: "Yes, I'm here" });
    const page = mockPage("https://wait.thaiticketmajor.com/view/?c=ticketmasterasia", {
      html: `
        <script>window.queueViewModel = { customerId: "ticketmasterasia" }</script>
        <h2>Still here?</h2>
        <p>Please confirm you're still waiting.</p>
        <button id="buttonConfirmVisitorPresence">Yes, I'm here</button>
      `,
      locators: new Map([["#buttonConfirmVisitorPresence", button]]),
    });

    const pending = holdQueue(page, concert(), 8, mockNotifier(), () => undefined);
    await vi.waitFor(() => expect(button.click).toHaveBeenCalledTimes(1));
    await vi.advanceTimersByTimeAsync(10_000);
    expect(button.click).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(21_000);
    await vi.waitFor(() => expect(button.click).toHaveBeenCalledTimes(2));

    page.setUrl("https://example.com/booking/fixed.php");
    await vi.advanceTimersByTimeAsync(1200);
    await pending;
  });

  it("emits manual intervention if Queue-it visitor presence click fails", async () => {
    vi.useFakeTimers();
    const button = mockLocator({ text: "Yes, I'm here", clickError: new Error("click failed") });
    const page = mockPage("https://wait.thaiticketmajor.com/view/?c=ticketmasterasia", {
      html: `
        <script>window.queueViewModel = { customerId: "ticketmasterasia" }</script>
        <h2>Still here?</h2>
        <p>Please confirm you're still waiting.</p>
        <button id="buttonConfirmVisitorPresence">Yes, I'm here</button>
      `,
      locators: new Map([["#buttonConfirmVisitorPresence", button]]),
    });
    const notifier = mockNotifier();
    const events: BotEvent[] = [];

    const pending = holdQueue(page, concert(), 4, notifier, (event) => events.push(event));
    await vi.waitFor(() => expect(button.click).toHaveBeenCalledTimes(1));
    page.setUrl("https://example.com/booking/fixed.php");
    await vi.advanceTimersByTimeAsync(1200);
    await pending;

    expect(events).toContainEqual({
      type: "state",
      botId: 4,
      state: "MANUAL_INTERVENTION",
      detail: "Queue presence confirmation required",
    });
    expect(events).toContainEqual({
      type: "alert",
      botId: 4,
      kind: "manual_intervention",
      message: "Bot 4: manual intervention (Queue presence confirmation required) - solve in browser",
    });
  });

  it("skips manual alert when dedupe callback rejects same manual page", async () => {
    vi.useFakeTimers();
    const visibleSelectors = new Set<string>();
    const page = mockPage("https://example.com/queue/wait", { visibleSelectors });
    const notifier = mockNotifier();
    const events: BotEvent[] = [];

    const pending = holdQueue(page, {
      ...concert(),
      queue_indicators: {
        ...concert().queue_indicators,
        captcha_selector: ".post-queue-captcha",
      },
    }, 5, notifier, (event) => events.push(event), {
      shouldEmitManualAlert: () => false,
    });
    await vi.waitFor(() => expect(page.content).toHaveBeenCalledTimes(1));

    visibleSelectors.add(".post-queue-captcha");
    page.setUrl("https://example.com/booking/form?noise=1");
    await vi.advanceTimersByTimeAsync(1200);
    await pending;

    expect(events.some((event) => event.type === "alert" && event.kind === "manual_intervention")).toBe(false);
    expect(notifier.send).not.toHaveBeenCalled();
  });
});

type MockPage = Page & {
  setUrl: (url: string) => void;
  content: ReturnType<typeof vi.fn<() => Promise<string>>>;
  waitForSelector: ReturnType<typeof vi.fn<(selector: string) => Promise<void>>>;
  locator: ReturnType<typeof vi.fn<(selector: string) => MockLocator>>;
};

type MockLocator = {
  first: ReturnType<typeof vi.fn<() => MockLocator>>;
  isVisible: ReturnType<typeof vi.fn<() => Promise<boolean>>>;
  isEnabled: ReturnType<typeof vi.fn<() => Promise<boolean>>>;
  textContent: ReturnType<typeof vi.fn<() => Promise<string | null>>>;
  click: ReturnType<typeof vi.fn<() => Promise<void>>>;
};

function mockPage(
  initialUrl: string,
  options: { html?: string; visibleSelectors?: Set<string>; locators?: Map<string, MockLocator> } = {},
): MockPage {
  let currentUrl = initialUrl;
  const visibleSelectors = options.visibleSelectors ?? new Set<string>();
  return {
    setUrl: (url: string) => {
      currentUrl = url;
    },
    url: () => currentUrl,
    content: vi.fn().mockResolvedValue(options.html ?? "<html></html>"),
    waitForSelector: vi.fn(async (selector: string) => {
      if (visibleSelectors.has(selector)) return;
      throw new Error(`selector not visible: ${selector}`);
    }),
    locator: vi.fn((selector: string) => options.locators?.get(selector) ?? mockLocator({ visible: false })),
  } as unknown as MockPage;
}

function mockLocator(
  options: { visible?: boolean; enabled?: boolean; text?: string; clickError?: Error } = {},
): MockLocator {
  const locator = {
    first: vi.fn<() => MockLocator>(),
    isVisible: vi.fn<() => Promise<boolean>>().mockResolvedValue(options.visible ?? true),
    isEnabled: vi.fn<() => Promise<boolean>>().mockResolvedValue(options.enabled ?? true),
    textContent: vi.fn<() => Promise<string | null>>().mockResolvedValue(options.text ?? null),
    click: vi.fn<() => Promise<void>>(async () => {
      if (options.clickError) throw options.clickError;
    }),
  };
  locator.first.mockReturnValue(locator);
  return locator;
}

function mockNotifier(): Notifier {
  const notifier = new Notifier({ enabled: false });
  vi.spyOn(notifier, "send").mockResolvedValue(undefined);
  return notifier;
}

function concert(): Concert {
  return {
    event_url: "https://www.thaiticketmajor.com/performance/example.html",
    event_date: "2026-12-15",
    zone_priority: [],
    ticket_count: 1,
    seat_retry_limit: 2,
    seat_strategy: { prefer_rows: [], avoid_rows: [], prefer_center: true },
    selectors: {
      buy_now_btn: "a.btn-buynow",
      zone_link: "a[href*='zone={zone}']",
    },
    queue_indicators: {
      queue_url_pattern: "/queue",
      verify_url_pattern: "/verify.php",
      captcha_selector: ".captcha",
      puzzle_selector: ".puzzle",
    },
    observability: {
      mode: "minimal",
      artifact_root: "bot_data/runs",
      capture_html: true,
      capture_screenshot: true,
      capture_network_failures: true,
      capture_console_errors: true,
      keep_runs: 10,
    },
  };
}
