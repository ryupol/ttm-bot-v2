import type { Page } from "playwright";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PageRouter } from "../src/bot/services/PageRouter.ts";
import type { PageKind } from "../src/bot/pages/classifier.ts";
import type { BotEvent } from "../src/ipc/types.ts";

const mocks = vi.hoisted(() => ({
  classifyCurrentPage: vi.fn(),
  detectManualInterventionOnPage: vi.fn(),
  classifyUnknownManualPage: vi.fn(),
}));

vi.mock("../src/bot/pages/classifier.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/bot/pages/classifier.ts")>();
  return {
    ...actual,
    classifyCurrentPage: mocks.classifyCurrentPage,
  };
});

vi.mock("../src/bot/manualIntervention.ts", () => ({
  detectManualInterventionOnPage: mocks.detectManualInterventionOnPage,
  classifyUnknownManualPage: mocks.classifyUnknownManualPage,
}));

describe("PageRouter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.classifyCurrentPage.mockResolvedValue("home");
    mocks.detectManualInterventionOnPage.mockResolvedValue({ present: false });
    mocks.classifyUnknownManualPage.mockReturnValue({ present: false });
  });

  it("requires page then short-circuits when stopped", async () => {
    const harness = createHarness({ kind: "queue", stopped: true });

    await harness.router.handleCurrentPage();

    expect(harness.getPage).toHaveBeenCalledOnce();
    expect(mocks.classifyCurrentPage).not.toHaveBeenCalled();
    expect(harness.events).toEqual([]);
    expect(harness.queueHolding.hold).not.toHaveBeenCalled();
    expect(harness.booking.bookSeats).not.toHaveBeenCalled();
    expect(harness.verification.submitCitizenId).not.toHaveBeenCalled();
  });

  it("emits waiting state and waits for fixed.php before classifying", async () => {
    const harness = createHarness({
      kind: "fixed",
      page: fakePage("https://booking.thaiticketmajor.com/booking/3m/zones.php"),
    });

    await harness.router.handleCurrentPage({ waitForFixed: true });

    expect(harness.events[0]).toEqual({
      type: "state",
      botId: 42,
      state: "AWAITING_USER",
      detail: "Waiting for fixed.php",
    });
    expect(harness.page.waitForURL).toHaveBeenCalledOnce();
    const [predicate, options] = harness.page.waitForURL.mock.calls[0];
    expect(predicate(new URL("https://booking.thaiticketmajor.com/booking/3m/fixed.php"))).toBe(true);
    expect(predicate(new URL("https://booking.thaiticketmajor.com/booking/3m/zones.php"))).toBe(false);
    expect(options).toEqual({ timeout: 12000 });
    expect(mocks.classifyCurrentPage).toHaveBeenCalledWith(harness.page);
    expect(harness.booking.bookSeats).toHaveBeenCalledWith(harness.page);
  });

  it.each([
    ["queue", "queueHolding.hold"],
    ["fixed", "booking.bookSeats"],
    ["verify", "verification.submitCitizenId"],
    ["verify_condition", "verification.submitTerms"],
    ["error", "booking.recoverFromErrorPage"],
    ["zones", "booking.enterNextZone"],
  ] as const)("dispatches %s page to %s", async (kind, serviceName) => {
    const harness = createHarness({ kind });

    await harness.router.handleCurrentPage();

    expect(harness.events).toEqual([
      { type: "log", botId: 42, message: `page classified: ${kind}` },
    ]);
    expect(serviceByName(harness, serviceName)).toHaveBeenCalledWith(harness.page);
  });

  it.each(["payment", "enroll"] as const)("emits done for terminal %s page", async (kind) => {
    const harness = createHarness({ kind });

    await harness.router.handleCurrentPage();

    expect(harness.emitDone).toHaveBeenCalledOnce();
    expect(harness.emitDone).toHaveBeenCalledWith(kind);
    expect(harness.events).toEqual([
      { type: "log", botId: 42, message: `page classified: ${kind}` },
    ]);
    expect(harness.forensics.event).not.toHaveBeenCalled();
  });

  it("emits manual intervention and waits for manual clear on unknown manual page", async () => {
    const manual = {
      present: true,
      reason: "captcha",
      detail: "captcha page",
      userMessage: "Human check required",
    };
    const harness = createHarness({ kind: "unknown" });
    mocks.detectManualInterventionOnPage.mockResolvedValue(manual);

    await harness.router.handleCurrentPage();

    expect(mocks.classifyUnknownManualPage).not.toHaveBeenCalled();
    expect(harness.emitManual).toHaveBeenCalledWith(
      "captcha",
      "manual-intervention-appears",
      "captcha page",
      "Human check required",
    );
    expect(harness.waitForManualClearThenResume).toHaveBeenCalledWith(harness.page);
    expect(harness.events).toEqual([
      { type: "log", botId: 42, message: "page classified: unknown" },
    ]);
  });

  it("falls back to unknown-page manual classification before generic unknown fallback", async () => {
    const manual = {
      present: true,
      reason: "unknown_page",
      detail: "booking.thaiticketmajor.com/mystery",
      userMessage: "Stuck at booking.thaiticketmajor.com/mystery",
    };
    const harness = createHarness({
      kind: "unknown",
      page: fakePage("https://booking.thaiticketmajor.com/mystery"),
    });
    mocks.detectManualInterventionOnPage.mockResolvedValue({ present: false });
    mocks.classifyUnknownManualPage.mockReturnValue(manual);

    await harness.router.handleCurrentPage();

    expect(mocks.classifyUnknownManualPage).toHaveBeenCalledWith({
      url: "https://booking.thaiticketmajor.com/mystery",
      knownPage: false,
    });
    expect(harness.emitManual).toHaveBeenCalledWith(
      "unknown_page",
      "manual-intervention-appears",
      "booking.thaiticketmajor.com/mystery",
      "Stuck at booking.thaiticketmajor.com/mystery",
    );
    expect(harness.waitForManualClearThenResume).toHaveBeenCalledWith(harness.page);
  });

  it("emits forensic unknown fallback when no manual intervention is present", async () => {
    const harness = createHarness({ kind: "unknown" });
    mocks.detectManualInterventionOnPage.mockResolvedValue({ present: false });
    mocks.classifyUnknownManualPage.mockReturnValue({ present: false });

    await harness.router.handleCurrentPage();

    expect(harness.forensics.captureDecision).toHaveBeenCalledWith("manual-intervention-appears");
    expect(harness.forensics.event).toHaveBeenCalledWith(
      "manual-intervention",
      "awaiting-user",
      { pageKind: "unknown" },
    );
    expect(harness.events).toEqual([
      { type: "log", botId: 42, message: "page classified: unknown" },
      { type: "state", botId: 42, state: "AWAITING_USER", detail: "Manual step: unknown" },
    ]);
  });
});

function createHarness(input: {
  kind?: PageKind;
  page?: FakePage;
  stopped?: boolean;
} = {}) {
  const page = input.page ?? fakePage("https://www.thaiticketmajor.com/index.html");
  const events: BotEvent[] = [];
  const queueHolding = { hold: vi.fn(async () => undefined) };
  const booking = {
    bookSeats: vi.fn(async () => undefined),
    recoverFromErrorPage: vi.fn(async () => undefined),
    enterNextZone: vi.fn(async () => undefined),
  };
  const verification = {
    submitCitizenId: vi.fn(async () => undefined),
    submitTerms: vi.fn(async () => undefined),
  };
  const forensics = {
    captureDecision: vi.fn(async () => undefined),
    event: vi.fn(),
  };
  const getPage = vi.fn(() => page);
  const emitDone = vi.fn();
  const emitManual = vi.fn(async () => undefined);
  const waitForManualClearThenResume = vi.fn(async () => undefined);
  mocks.classifyCurrentPage.mockResolvedValue(input.kind ?? "home");
  const router = new PageRouter({
    botId: 42,
    getPage,
    shouldStop: () => input.stopped ?? false,
    manualSolveTimeoutSeconds: 12,
    emit: (event) => events.push(event),
    emitManual,
    waitForManualClearThenResume,
    emitDone,
    queueHolding,
    booking,
    verification,
    forensics,
  });
  return {
    router,
    page,
    events,
    getPage,
    queueHolding,
    booking,
    verification,
    forensics,
    emitDone,
    emitManual,
    waitForManualClearThenResume,
  };
}

type FakePage = Page & {
  waitForURL: ReturnType<typeof vi.fn>;
};

function fakePage(url: string): FakePage {
  return {
    url: () => url,
    content: vi.fn(async () => ""),
    waitForURL: vi.fn(async () => undefined),
  } as unknown as FakePage;
}

function serviceByName(harness: ReturnType<typeof createHarness>, name: string) {
  const [service, method] = name.split(".") as [
    "queueHolding" | "booking" | "verification",
    string,
  ];
  return harness[service][method as keyof (typeof harness)[typeof service]];
}
