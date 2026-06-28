import { describe, expect, it, vi } from "vitest";
import { selectSeatsOnFixedPage, type FixedPageResult } from "../src/bot/pages/fixed.ts";
import type { Concert } from "../src/config/schema.ts";

describe("selectSeatsOnFixedPage", () => {
  it("skips non fixed page", async () => {
    const page = mockPage("https://example.com/zones.php", { status: "confirmed", picks: [] });
    await expect(selectSeatsOnFixedPage(page, concert())).resolves.toBeNull();
  });

  it("returns confirmed picks from page script", async () => {
    const result: FixedPageResult = { status: "confirmed", picks: [{ id: "checkseat-A-1", row: "A", col: 1 }] };
    const page = mockPage("https://example.com/fixed.php", result);
    await expect(selectSeatsOnFixedPage(page, concert())).resolves.toEqual(result);
  });

  it("retries no-seat result up to retry limit", async () => {
    const page = mockPage("https://example.com/fixed.php", { status: "no_seats" });
    await selectSeatsOnFixedPage(page, { ...concert(), seat_retry_limit: 3 });
    expect(page.evaluate).toHaveBeenCalledTimes(3);
  });

  it("retries selection alert results up to retry limit", async () => {
    const page = mockPage("https://example.com/fixed.php", { status: "selection_not_applied" });

    await expect(selectSeatsOnFixedPage(page, { ...concert(), seat_retry_limit: 3 })).resolves.toEqual({ status: "no_picks" });
    expect(page.evaluate).toHaveBeenCalledTimes(3);
  });

  it("treats enroll redirect as confirmed", async () => {
    let currentUrl = "https://example.com/fixed.php";
    const page = {
      url: () => currentUrl,
      evaluate: vi.fn().mockResolvedValue({ status: "no_seats" }),
      waitForFunction: vi.fn().mockImplementation(() => {
        currentUrl = "https://example.com/enroll.php";
        return Promise.reject(new Error("navigated"));
      }),
      waitForTimeout: vi.fn().mockResolvedValue(undefined),
    };

    await expect(selectSeatsOnFixedPage(page, concert())).resolves.toEqual({ status: "confirmed", picks: [] });
  });

  it("treats execution-context loss during payment navigation as confirmed", async () => {
    let currentUrl = "https://example.com/fixed.php";
    const page = {
      url: () => currentUrl,
      evaluate: vi.fn().mockImplementation(() => {
        currentUrl = "https://example.com/paymentall.php";
        return Promise.reject(new Error("page.evaluate: Execution context was destroyed, most likely because of a navigation."));
      }),
      waitForFunction: vi.fn().mockResolvedValue(undefined),
      waitForTimeout: vi.fn().mockResolvedValue(undefined),
    };

    await expect(selectSeatsOnFixedPage(page, concert())).resolves.toEqual({ status: "confirmed", picks: [] });
  });

});

function mockPage(url: string, result: FixedPageResult | { status: "selection_not_applied" }) {
  return {
    url: () => url,
    evaluate: vi.fn().mockResolvedValue(result),
    waitForFunction: vi.fn().mockResolvedValue(undefined),
    waitForTimeout: vi.fn().mockResolvedValue(undefined),
  };
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
