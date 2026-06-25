import { describe, expect, it, vi } from "vitest";
import { selectSeatsOnFixedPage, type FixedPageResult } from "../src/bot/pages/fixed.js";
import type { Concert } from "../src/config/schema.js";

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
});

function mockPage(url: string, result: FixedPageResult) {
  return {
    url: () => url,
    evaluate: vi.fn().mockResolvedValue(result),
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
  };
}
