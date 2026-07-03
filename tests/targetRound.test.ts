import { readFileSync } from "node:fs";
import path from "node:path";
import type { Page } from "playwright";
import { beforeEach, describe, expect, it } from "vitest";
import { resolveTargetRoundOnPage, TargetRoundResolver, type TargetRoundCandidate } from "../src/bot/booking/TargetRoundResolver.ts";

const fixture = readFileSync(path.join(process.cwd(), "tests/fixtures/pond-phuwin-event.html"), "utf8");

type FakeRound = {
  itemText: string;
  dateText: string;
  dataButton: string;
  href: string;
  onclick: string;
  disabled: boolean;
  timeText: string;
  statusText: string;
};

class FakeTextElement {
  constructor(public readonly textContent: string) {}
}

class FakeButtonElement {
  public readonly textContent: string;

  constructor(private readonly round: FakeRound) {
    this.textContent = round.timeText;
  }

  querySelector(selector: ".item-show") {
    if (selector === ".item-show") return new FakeTextElement(this.round.timeText);
    return null;
  }

  getAttribute(name: string) {
    const attributes: Record<string, string> = {
      "data-button": this.round.dataButton,
      href: this.round.href,
      onclick: this.round.onclick,
    };
    return attributes[name] ?? null;
  }

  hasAttribute(name: string) {
    return name === "disabled" ? this.round.disabled : this.getAttribute(name) !== null;
  }
}

class FakeRowElement {
  public readonly textContent: string;

  constructor(private readonly round: FakeRound) {
    this.textContent = `${round.dateText} ${round.timeText} ${round.statusText}`;
  }

  querySelector(selector: ".date" | "a.btn[data-button]") {
    if (selector === ".date") return new FakeTextElement(this.round.dateText);
    if (selector === "a.btn[data-button]") return new FakeButtonElement(this.round);
    return null;
  }
}

class FakeItemElement {
  public readonly textContent: string;

  constructor(private readonly round: FakeRound) {
    this.textContent = round.itemText;
  }

  querySelectorAll(selector: ".box-event-list .row") {
    if (selector === ".box-event-list .row") return [new FakeRowElement(this.round)];
    return [];
  }
}

class FakeDocument {
  private readonly rounds: FakeRound[];

  constructor(html: string) {
    expect(html).toContain("section-event-round");
    this.rounds = Array.from(html.matchAll(/<div class="event-detail-item">([\s\S]*?)(?=<div class="event-detail-item">|<\/section>)/g)).map(
      ([, itemHtml]) => ({
        itemText: stripTags(itemHtml),
        dateText: extractText(itemHtml, /<div class="date">([\s\S]*?)<\/div>/),
        dataButton: extractAttribute(itemHtml, "data-button"),
        href: extractAttribute(itemHtml, "href"),
        onclick: extractAttribute(itemHtml, "onclick"),
        disabled: /<a\b[^>]*\sdisabled(?:\s|>|=)/.test(itemHtml),
        timeText: extractText(itemHtml, /<span class="item-show">([\s\S]*?)<\/span>/),
        statusText: extractText(itemHtml, /<small>([\s\S]*?)<\/small>/),
      }),
    );
    expect(this.rounds.length).toBeGreaterThanOrEqual(1);
  }

  querySelectorAll(selector: ".event-detail-item") {
    if (selector === ".event-detail-item") return this.rounds.map((round) => new FakeItemElement(round));
    return [];
  }
}

function extractText(html: string, pattern: RegExp) {
  return stripTags(pattern.exec(html)?.[1] ?? "");
}

function extractAttribute(html: string, name: string) {
  return new RegExp(`${name}="([^"]*)"`).exec(html)?.[1] ?? "";
}

function stripTags(html: string) {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function createFakePage(html: string): Page {
  const fakeDocument = new FakeDocument(html);
  return {
    async evaluate(pageFunction: (arg: unknown) => unknown, arg: unknown) {
      const globalScope = globalThis as unknown as { document?: FakeDocument };
      const previousDocument = globalScope.document;
      globalScope.document = fakeDocument;
      try {
        return pageFunction(arg);
      } finally {
        globalScope.document = previousDocument;
      }
    },
  } as unknown as Page;
}

describe("resolveTargetRoundOnPage", () => {
  let page: Page;

  beforeEach(() => {
    page = createFakePage(fixture);
  });

  it("selects offline round instead of live streaming or rerun", async () => {
    const result = await resolveTargetRoundOnPage(page, {
      date: "2026-08-21",
      time: "18:00",
      type: "offline",
    });

    expect(result?.dataButton).toBe("9253");
    expect(result?.type).toBe("offline");
    expect(result?.disabled).toBe(true);
    expect(result?.queueOrBookingCapable).toBe(false);
  });

  it("selects live streaming when explicitly configured", async () => {
    const result = await resolveTargetRoundOnPage(page, {
      date: "2026-08-21",
      time: "18:00",
      type: "live_streaming",
    });

    expect(result?.dataButton).toBe("9254");
    expect(result?.type).toBe("live_streaming");
  });

  it("selects rerun when explicitly configured", async () => {
    const result = await resolveTargetRoundOnPage(page, {
      date: "2026-08-21",
      time: "10:00",
      type: "rerun",
    });

    expect(result?.dataButton).toBe("9255");
    expect(result?.type).toBe("rerun");
  });

  it("detects enabled queue or booking capable round", async () => {
    page = createFakePage(
      fixture.replace(
        'data-button="9253" href="javascript:;" class="btn" disabled',
        'data-button="9256" href="/queue/booking/zones.php" class="btn" onclick="openBookingQueue()"',
      ),
    );

    const result = await resolveTargetRoundOnPage(page, {
      date: "2026-08-21",
      time: "18:00",
      type: "offline",
    });

    expect(result?.dataButton).toBe("9256");
    expect(result?.queueOrBookingCapable).toBe(true);
  });

  it("keeps main behavior for signin-gated booking links", async () => {
    page = createFakePage(
      fixture.replace(
        'data-button="9253" href="javascript:;" class="btn" disabled',
        'data-button="9256" href="javascript:;" class="btn" onclick="$app.popup.signin(\'https://booking.thaiticketmajor.com/booking/3m/zones.php?query=557\')"',
      ),
    );

    const result = await resolveTargetRoundOnPage(page, {
      date: "2026-08-21",
      time: "18:00",
      type: "offline",
    });

    expect(result?.dataButton).toBe("9256");
    expect(result?.queueOrBookingCapable).toBe(true);
  });

  it("detects sold out target round from sibling status text", async () => {
    page = createFakePage(
      fixture.replace(
        '<a data-button="9253" href="javascript:;" class="btn" disabled><span class="item-show">18:00</span></a>',
        '<a data-button="9202" href="javascript:;" class="btn" disabled=""><span class="item-show">18:00</span><span class="item-hide"></span></a><small>Sold out</small>',
      ),
    );

    const result = await resolveTargetRoundOnPage(page, {
      date: "2026-08-21",
      time: "18:00",
      type: "offline",
    });

    expect(result?.dataButton).toBe("9202");
    expect(result?.disabled).toBe(true);
    expect(result?.soldOut).toBe(true);
    expect(result?.queueOrBookingCapable).toBe(false);
  });

  it("matches Thai Buddhist date text derived from ISO date", async () => {
    page = createFakePage(
      fixture
        .replace('data-button="9253"', 'data-button="9257"')
        .replace("วันศุกร์ที่ 21 สิงหาคม 2569", "วันจันทร์ที่ 24 สิงหาคม 2569"),
    );

    const result = await resolveTargetRoundOnPage(page, {
      date: "2026-08-24",
      time: "18:00",
      type: "offline",
    });

    expect(result?.dataButton).toBe("9257");
  });

  it("returns undefined when exact target is missing", async () => {
    const result = await resolveTargetRoundOnPage(page, {
      date: "2026-08-22",
      time: "18:00",
      type: "offline",
    });

    expect(result).toBeUndefined();
  });
});

describe("TargetRoundResolver", () => {
  it("matches round candidates without Playwright page dependency", () => {
    const resolver = new TargetRoundResolver();
    const result = resolver.matchTargetRound([
      targetRoundCandidate({
        dataButton: "live",
        type: "live_streaming",
        href: "/booking/live",
      }),
      targetRoundCandidate({
        dataButton: "offline",
        type: "offline",
        href: "/queue/booking/zones.php",
      }),
    ], {
      date: "2026-08-21",
      time: "18:00",
      type: "offline",
    });

    expect(result).toEqual({
      dataButton: "offline",
      dateText: "วันศุกร์ที่ 21 สิงหาคม 2569",
      timeText: "18:00",
      type: "offline",
      disabled: false,
      soldOut: false,
      href: "/queue/booking/zones.php",
      onclick: "",
      label: "18:00",
      queueOrBookingCapable: true,
    });
  });

  it("keeps sold-out candidates out of booking-capable state", () => {
    const resolver = new TargetRoundResolver();

    expect(resolver.matchTargetRound([
      targetRoundCandidate({
        onclick: "$app.popup.signin('/booking/3m/zones.php')",
      }),
    ], {
      date: "2026-08-21",
      time: "18:00",
      type: "any",
    })).toMatchObject({
      queueOrBookingCapable: true,
    });

    expect(resolver.matchTargetRound([
      targetRoundCandidate({
        disabled: true,
        rowText: "Sold out",
      }),
    ], {
      date: "2026-08-21",
      time: "18:00",
      type: "any",
    })).toMatchObject({
      soldOut: true,
      queueOrBookingCapable: false,
    });
  });
});

function targetRoundCandidate(overrides: Partial<TargetRoundCandidate> = {}): TargetRoundCandidate {
  return {
    dataButton: "9253",
    dateText: "วันศุกร์ที่ 21 สิงหาคม 2569",
    timeText: "18:00",
    type: "offline",
    disabled: false,
    href: "",
    onclick: "",
    label: "18:00",
    rowText: "",
    ...overrides,
  };
}
