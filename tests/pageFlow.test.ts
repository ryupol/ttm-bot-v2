import { describe, expect, it, vi } from "vitest";
import { commandFlowForPage, waitForFixedPageNavigation, zoneFromUrl } from "../src/bot/routing/PageFlowPolicy.ts";

describe("pageFlow", () => {
  it("resumes current booking pages for go instead of restarting at event", () => {
    expect(commandFlowForPage("queue")).toBe("resume");
    expect(commandFlowForPage("zones")).toBe("resume");
    expect(commandFlowForPage("fixed")).toBe("resume");
    expect(commandFlowForPage("payment")).toBe("resume");
    expect(commandFlowForPage("enroll")).toBe("resume");
  });

  it("starts acquisition from event or home pages", () => {
    expect(commandFlowForPage("event")).toBe("acquire");
    expect(commandFlowForPage("home")).toBe("acquire");
  });

  it("reads current zone from fixed page URL", () => {
    expect(zoneFromUrl("https://booking.thaiticketmajor.com/booking/fixed.php?zone=SC")).toBe("SC");
    expect(zoneFromUrl("not a url")).toBeUndefined();
  });

  it("treats aborted wait as success when zone click reaches fixed page", async () => {
    const page = {
      url: () => "https://booking.thaiticketmajor.com/booking/3m/fixed.php?k=abc&zone=A2&round=81722",
      waitForURL: vi.fn().mockRejectedValue(new Error("page.waitForURL: net::ERR_ABORTED; maybe frame was detached?")),
    };

    await expect(waitForFixedPageNavigation(page, 18000)).resolves.toBe(true);
  });

  it("keeps polling current URL after aborted wait", async () => {
    const urls = [
      "https://booking.thaiticketmajor.com/booking/3m/zones.php?query=557",
      "https://booking.thaiticketmajor.com/booking/3m/fixed.php?k=abc&zone=A2&round=81722",
    ];
    const page = {
      url: vi.fn(() => urls.shift() ?? urls.at(-1) ?? ""),
      waitForURL: vi.fn().mockRejectedValue(new Error("fixed page navigation not reached")),
    };

    await expect(waitForFixedPageNavigation(page, 100, 1)).resolves.toBe(true);
  });
});
