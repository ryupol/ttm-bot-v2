import type { Page } from "playwright";
import { describe, expect, it, vi } from "vitest";
import type { BotEvent } from "../src/ipc/types.ts";
import { PageStatusReporter } from "../src/bot/services/PageStatusReporter.ts";

describe("PageStatusReporter", () => {
  it("reports stopped before requiring page", async () => {
    const events: BotEvent[] = [];
    const getPage = vi.fn(() => {
      throw new Error("page should not be required");
    });

    const reporter = new PageStatusReporter({
      botId: 7,
      emit: (event) => events.push(event),
      getPage,
      shouldStop: () => true,
      emitRecentAccessBlock: () => false,
      emitDone: vi.fn(),
    });

    await reporter.check();

    expect(getPage).not.toHaveBeenCalled();
    expect(events).toEqual([
      { type: "state", botId: 7, state: "STOPPED", detail: "Stopped by user" },
    ]);
  });

  it("returns immediately when recent access block is emitted", async () => {
    const events: BotEvent[] = [];
    const page = fakePage("https://booking.thaiticketmajor.com/booking/3m/fixed.php");

    const reporter = new PageStatusReporter({
      botId: 2,
      emit: (event) => events.push(event),
      getPage: () => page,
      shouldStop: () => false,
      emitRecentAccessBlock: () => true,
      emitDone: vi.fn(),
    });

    await reporter.check();

    expect(events).toEqual([]);
  });

  it.each([
    {
      url: "https://wait.thaiticketmajor.com/queue",
      event: { type: "state", botId: 3, state: "IN_QUEUE", detail: "Current page: queue" },
    },
    {
      url: "https://booking.thaiticketmajor.com/booking/3m/zones.php?query=557",
      event: { type: "state", botId: 3, state: "BOOKING", detail: "Current page: zones" },
    },
    {
      url: "https://booking.thaiticketmajor.com/booking/3m/fixed.php?zone=A2",
      event: { type: "state", botId: 3, state: "BOOKING", detail: "Current page: fixed" },
    },
    {
      url: "https://www.thaiticketmajor.com/concert/test.html",
      event: { type: "state", botId: 3, state: "READY", detail: "Current page: event" },
    },
    {
      url: "https://www.thaiticketmajor.com/index.html",
      event: { type: "state", botId: 3, state: "AWAITING_USER", detail: "Current page: home" },
    },
  ] as const)("reports current page status for $url", async ({ url, event }) => {
    const events: BotEvent[] = [];
    const reporter = new PageStatusReporter({
      botId: 3,
      emit: (emitted) => events.push(emitted),
      getPage: () => fakePage(url),
      shouldStop: () => false,
      emitRecentAccessBlock: () => false,
      emitDone: vi.fn(),
    });

    await reporter.check();

    expect(events).toEqual([
      { type: "log", botId: 3, message: `check: ${event.detail}; url=${url}` },
      event,
    ]);
  });

  it("reports manual intervention detail and user message", async () => {
    const events: BotEvent[] = [];
    const url = "https://event.thaiticketmajor.com/user/signin.php?query=557";
    const reporter = new PageStatusReporter({
      botId: 4,
      emit: (event) => events.push(event),
      getPage: () => fakePage(url, "<form id='frm-signin-page'></form>"),
      shouldStop: () => false,
      emitRecentAccessBlock: () => false,
      emitDone: vi.fn(),
    });

    await reporter.check();

    expect(events).toEqual([
      { type: "log", botId: 4, message: `check: Current page: login; manual=login; url=${url}` },
      { type: "state", botId: 4, state: "MANUAL_INTERVENTION", detail: "Login required" },
    ]);
  });

  it.each([
    ["payment", "https://booking.thaiticketmajor.com/booking/3m/paymentall.php"],
    ["enroll", "https://booking.thaiticketmajor.com/booking/3m/enroll.php"],
  ] as const)("delegates terminal %s pages to emitDone", async (kind, url) => {
    const events: BotEvent[] = [];
    const emitDone = vi.fn();
    const reporter = new PageStatusReporter({
      botId: 5,
      emit: (event) => events.push(event),
      getPage: () => fakePage(url),
      shouldStop: () => false,
      emitRecentAccessBlock: () => false,
      emitDone,
    });

    await reporter.check();

    expect(events).toEqual([
      { type: "log", botId: 5, message: `check: Current page: ${kind}; url=${url}` },
    ]);
    expect(emitDone).toHaveBeenCalledOnce();
    expect(emitDone).toHaveBeenCalledWith(kind);
  });
});

function fakePage(url: string, html = ""): Page {
  return {
    url: () => url,
    content: () => Promise.resolve(html),
  } as unknown as Page;
}
