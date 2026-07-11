import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BrowserContext, Page, Response } from "playwright";

const mocks = vi.hoisted(() => ({
  launchPersistentContext: vi.fn(),
}));

vi.mock("playwright", () => ({
  chromium: {
    launchPersistentContext: mocks.launchPersistentContext,
  },
}));

describe("BrowserSession", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("keeps browser startup alive when initial base_url navigation times out", async () => {
    const { BrowserSession } = await import("../src/bot/browser/BrowserSession.ts");
    const timeout = new Error("page.goto: Timeout 30000ms exceeded.");
    const page = fakePage({ gotoError: timeout });
    const context = fakeContext({ newPage: page });
    const logs: string[] = [];
    mocks.launchPersistentContext.mockResolvedValue(context);

    const session = new BrowserSession({
      rootDir: "/tmp/ttm",
      botId: 1,
      totalBots: 1,
      settings: {
        base_url: "https://www.thaiticketmajor.com",
        headless: true,
        manual_solve_timeout: 300,
        auto_login_on_startup: true,
        debug: false,
        browser: { name: "chromium" },
        window: { screen_width: 1440, screen_height: 900, gap: 8 },
        telegram: { enabled: false, token_env: "TELEGRAM_TOKEN", chat_id_env: "TELEGRAM_CHAT_ID" },
      },
      onLog: (message) => logs.push(message),
    });

    await expect(session.launch()).resolves.toBe(page);
    expect(page.goto).toHaveBeenCalledWith("https://www.thaiticketmajor.com", { waitUntil: "domcontentloaded" });
    expect(logs).toContain("initial page load skipped: page.goto: Timeout 30000ms exceeded.");
  });
});

function fakePage(options: { gotoError?: Error } = {}): Page {
  return {
    close: vi.fn(async () => undefined),
    goto: vi.fn(async () => {
      if (options.gotoError) throw options.gotoError;
    }),
    on: vi.fn((_event: "response", _handler: (response: Response) => void) => undefined),
  } as unknown as Page;
}

function fakeContext(options: { newPage: Page }): BrowserContext {
  return {
    pages: vi.fn(() => []),
    newPage: vi.fn(async () => options.newPage),
    newCDPSession: vi.fn(async () => ({
      send: vi.fn(async (method: string) => method === "Browser.getWindowForTarget" ? { windowId: 1 } : undefined),
    })),
  } as unknown as BrowserContext;
}
