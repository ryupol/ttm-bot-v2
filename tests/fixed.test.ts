import { describe, expect, it, vi } from "vitest";
import { FixedPageSeatSelector, selectSeatsOnFixedPage, type FixedPageResult } from "../src/bot/booking/FixedPageSeatSelector.ts";
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
    const page = mockPage("https://example.com/fixed.php", { status: "no_seats" }, { availableSeatCount: 1 });
    await selectSeatsOnFixedPage(page, { ...concert(), seat_retry_limit: 3 });
    expect(page.evaluate).toHaveBeenCalledTimes(6);
  });

  it("retries selection alert results up to retry limit", async () => {
    const page = mockPage("https://example.com/fixed.php", { status: "selection_not_applied" }, { availableSeatCount: 1 });

    await expect(selectSeatsOnFixedPage(page, { ...concert(), seat_retry_limit: 3 })).resolves.toEqual({ status: "selection_not_applied" });
    expect(page.evaluate).toHaveBeenCalledTimes(6);
  });

  it("passes rejected seats to the next selection retry", async () => {
    const selectionParams: Array<{ rejectedSeatIds: string[] }> = [];
    const page = {
      url: () => "https://example.com/fixed.php",
      evaluate: vi.fn().mockImplementation((_, params) => {
        if (!params) return Promise.resolve(2);
        selectionParams.push(params);
        if (selectionParams.length === 1) {
          return Promise.resolve({
            status: "selection_not_applied",
            rejectedSeatIds: ["checkseat-A-1"],
          });
        }
        return Promise.resolve({
          status: "confirmed",
          picks: [{ id: "checkseat-A-2", row: "A", col: 2 }],
        });
      }),
      waitForFunction: vi.fn().mockResolvedValue(undefined),
      waitForTimeout: vi.fn().mockResolvedValue(undefined),
    };

    await expect(selectSeatsOnFixedPage(page, { ...concert(), seat_retry_limit: 3 })).resolves.toEqual({
      status: "confirmed",
      picks: [{ id: "checkseat-A-2", row: "A", col: 2 }],
    });
    expect(selectionParams).toHaveLength(2);
    expect(selectionParams[0].rejectedSeatIds).toEqual([]);
    expect(selectionParams[1].rejectedSeatIds).toEqual(["checkseat-A-1"]);
  });

  it("returns no_seats fast when seat map has only unavailable seats", async () => {
    const page = mockPage("https://example.com/fixed.php", { status: "confirmed", picks: [] }, { availableSeatCount: 0 });

    await expect(selectSeatsOnFixedPage(page, { ...concert(), seat_retry_limit: 3 })).resolves.toEqual({ status: "no_seats" });
    expect(page.evaluate).toHaveBeenCalledTimes(1);
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

  it("does not confirm when execution-context loss lands on a non-booking page", async () => {
    let currentUrl = "https://example.com/fixed.php";
    const page = {
      url: () => currentUrl,
      evaluate: vi.fn().mockImplementation(() => {
        currentUrl = "https://example.com/user/signin.php";
        return Promise.reject(new Error("page.evaluate: Execution context was destroyed, most likely because of a navigation."));
      }),
      waitForFunction: vi.fn().mockResolvedValue(undefined),
      waitForTimeout: vi.fn().mockResolvedValue(undefined),
    };

    await expect(selectSeatsOnFixedPage(page, concert())).resolves.toBeNull();
  });

  it("returns null instead of no_seats when seat wait ends off the fixed page", async () => {
    let currentUrl = "https://example.com/fixed.php";
    const page = {
      url: () => currentUrl,
      evaluate: vi.fn(),
      waitForFunction: vi.fn().mockImplementation(() => {
        currentUrl = "https://example.com/queue";
        return Promise.reject(new Error("navigated"));
      }),
      waitForTimeout: vi.fn().mockResolvedValue(undefined),
    };

    await expect(selectSeatsOnFixedPage(page, concert())).resolves.toBeNull();
    expect(page.evaluate).not.toHaveBeenCalled();
  });

});

describe("FixedPageSeatSelector", () => {
  it("exposes class seam with same fixed-page selection behavior", async () => {
    const result: FixedPageResult = { status: "confirmed", picks: [{ id: "checkseat-A-1", row: "A", col: 1 }] };
    const page = mockPage("https://example.com/fixed.php", result);
    const selector = new FixedPageSeatSelector(concert());

    await expect(selector.select(page)).resolves.toEqual(result);
  });

  it("keeps retry policy inside selector instance", async () => {
    const page = mockPage("https://example.com/fixed.php", { status: "selection_not_applied" }, { availableSeatCount: 1 });
    const selector = new FixedPageSeatSelector({ ...concert(), seat_retry_limit: 3 });

    await expect(selector.select(page)).resolves.toEqual({ status: "selection_not_applied" });
    expect(page.evaluate).toHaveBeenCalledTimes(6);
  });
});

function mockPage(
  url: string,
  result: FixedPageResult | { status: "selection_not_applied" },
  options: { availableSeatCount?: number } = {},
) {
  let evaluateCalls = 0;
  const availableSeatCount = options.availableSeatCount ?? 1;
  return {
    url: () => url,
    evaluate: vi.fn().mockImplementation(() => {
      evaluateCalls += 1;
      if (evaluateCalls % 2 === 1) return Promise.resolve(availableSeatCount);
      return Promise.resolve(result);
    }),
    waitForFunction: vi.fn().mockResolvedValue(undefined),
    waitForTimeout: vi.fn().mockResolvedValue(undefined),
  };
}

function concert(): Concert {
  return {
    event_url: "https://www.thaiticketmajor.com/performance/example.html",
    zone_priority: [],
    max_zone_cycles: 0,
    zone_cycle_alert_every: 5,
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
