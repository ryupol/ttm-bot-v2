# TTM Queue-Ready Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build queue-ready mode for five TTM browser sessions: exact target-round selection, queue/sale timing, manual-intervention pause, and low-overhead forensic observability.

**Architecture:** Add focused modules for target-round resolution, queue watcher scheduling, manual-intervention detection, and forensic run logging. Keep worker orchestration in `src/bot/worker.ts`, but move decision logic into small pure/testable modules so live TTM pages are not needed for unit tests.

**Tech Stack:** TypeScript, Playwright, worker_threads, Ink, Zod, Vitest, YAML.

---

## File Structure

- Modify `src/config/schema.ts`: add `target_round`, `queue_start`, `sale_start`, and `observability` config schemas.
- Modify `config/concert.yaml`: configure Pond Phuwin target round and queue/sale times.
- Create `src/bot/targetRound.ts`: pure DOM resolver plus Playwright wrapper for exact target round.
- Create `tests/fixtures/pond-phuwin-event.html`: saved event-round HTML fixture with offline/live/rerun blocks.
- Create `tests/targetRound.test.ts`: resolver tests.
- Create `src/bot/queueSchedule.ts`: reload schedule and per-bot offset helpers.
- Create `tests/queueSchedule.test.ts`: schedule tests.
- Create `src/bot/manualIntervention.ts`: manual-intervention detector and transition helper.
- Create `tests/manualIntervention.test.ts`: detector/transition tests with HTML fixtures.
- Create `src/bot/forensics.ts`: run folder, JSONL events, screenshot/html capture, redaction helpers, Playwright listeners.
- Create `tests/forensics.test.ts`: path naming, JSONL shape, redaction tests.
- Modify `src/bot/pages/queue.ts`: replace single CAPTCHA boolean with manual-intervention transition handling.
- Modify `src/bot/worker.ts`: integrate prepare target validation, queue-ready watcher, forensic captures, and manual intervention pauses.
- Modify `src/ipc/types.ts`: add `arm` command, new states, new alert kind, and richer worker events if needed.
- Modify `src/ipc/commands.ts`: parse `arm all|N`.
- Modify `src/main.ts`: dispatch `arm`, perform main-level preflight and scheduling.
- Modify `src/tui/BotGrid.tsx` if state display assumptions need color labels.
- Modify `tests/commands.test.ts`, `tests/config.test.ts`: cover new commands/config.
- Update `README.md`: queue-ready runbook.

## Task 1: Config Schema and Example Config

**Files:**
- Modify: `src/config/schema.ts`
- Modify: `config/concert.yaml`
- Test: `tests/config.test.ts`

- [ ] **Step 1: Write failing config test**

Add this test to `tests/config.test.ts`:

```ts
it("loads queue-ready target round and observability config", () => {
  const root = path.join(tmpdir(), `ttm-config-queue-${Date.now()}`);
  mkdirSync(path.join(root, "config"), { recursive: true });
  mkdirSync(path.join(root, "secrets"), { recursive: true });
  writeFileSync(path.join(root, "config/settings.yaml"), settingsYaml());
  writeFileSync(path.join(root, "config/accounts.yaml"), "accounts:\n  - id: 1\n");
  writeFileSync(
    path.join(root, "config/concert.yaml"),
    `
event_url: https://www.thaiticketmajor.com/concert/example.html
event_date: "2026-08-21"
target_round:
  date: "2026-08-21"
  time: "18:00"
  type: offline
queue_start: "2026-06-28T09:00:00+07:00"
sale_start: "2026-06-28T10:00:00+07:00"
zone_priority: ["SC"]
ticket_count: 2
seat_strategy:
  prefer_rows: []
  avoid_rows: []
  prefer_center: false
selectors:
  buy_now_btn: "a.btn-buynow"
  zone_link: "a[href*='zone={zone}']"
queue_indicators:
  queue_url_pattern: "/queue"
  verify_url_pattern: "/verify.php"
  captcha_selector: ".captcha"
  puzzle_selector: ".puzzle"
observability:
  mode: forensic
  artifact_root: bot_data/runs
  capture_html: true
  capture_screenshot: true
  capture_network_failures: true
  capture_console_errors: true
  keep_runs: 10
`,
  );

  const { config } = loadAppConfig({ rootDir: root });

  expect(config.concert.target_round).toEqual({
    date: "2026-08-21",
    time: "18:00",
    type: "offline",
  });
  expect(config.concert.queue_start).toBe("2026-06-28T09:00:00+07:00");
  expect(config.concert.sale_start).toBe("2026-06-28T10:00:00+07:00");
  expect(config.concert.observability.mode).toBe("forensic");
});
```

- [ ] **Step 2: Run test to verify failure**

Run:

```bash
npm test -- tests/config.test.ts
```

Expected: fail because `target_round`, `queue_start`, `sale_start`, or `observability` are stripped/missing from schema output.

- [ ] **Step 3: Implement schema**

Update `src/config/schema.ts`:

```ts
const TargetRoundSchema = z.object({
  date: z.string(),
  time: z.string(),
  type: z.enum(["offline", "live_streaming", "rerun", "any"]).default("offline"),
});

const ObservabilitySchema = z.object({
  mode: z.enum(["forensic", "minimal"]).default("minimal"),
  artifact_root: z.string().default("bot_data/runs"),
  capture_html: z.boolean().default(true),
  capture_screenshot: z.boolean().default(true),
  capture_network_failures: z.boolean().default(true),
  capture_console_errors: z.boolean().default(true),
  keep_runs: z.number().int().positive().default(10),
});
```

Add fields inside `ConcertSchema`:

```ts
target_round: TargetRoundSchema.optional(),
queue_start: z.string().datetime({ offset: true }).optional(),
sale_start: z.string().datetime({ offset: true }).optional(),
observability: ObservabilitySchema.default({
  mode: "minimal",
  artifact_root: "bot_data/runs",
  capture_html: true,
  capture_screenshot: true,
  capture_network_failures: true,
  capture_console_errors: true,
  keep_runs: 10,
}),
```

Export:

```ts
export type TargetRound = z.infer<typeof TargetRoundSchema>;
export type Observability = z.infer<typeof ObservabilitySchema>;
```

- [ ] **Step 4: Update live config**

Modify `config/concert.yaml`:

```yaml
target_round:
  date: "2026-08-21"
  time: "18:00"

  # type options:
  # - offline: physical venue concert; excludes Live Streaming and RERUN
  # - live_streaming: TTM LIVE live stream product
  # - rerun: replay product
  # - any: first matching date/time; risky, not recommended
  type: "offline"

queue_start: "2026-06-28T09:00:00+07:00"
sale_start: "2026-06-28T10:00:00+07:00"

observability:
  mode: forensic
  artifact_root: bot_data/runs
  capture_html: true
  capture_screenshot: true
  capture_network_failures: true
  capture_console_errors: true
  keep_runs: 10
```

- [ ] **Step 5: Verify tests pass**

Run:

```bash
npm test -- tests/config.test.ts
npm run typecheck
```

Expected: both pass.

- [ ] **Step 6: Commit**

```bash
git add src/config/schema.ts config/concert.yaml tests/config.test.ts
git commit -m "feat: add queue-ready config"
```

## Task 2: Target Round Resolver

**Files:**
- Create: `src/bot/targetRound.ts`
- Create: `tests/fixtures/pond-phuwin-event.html`
- Create: `tests/targetRound.test.ts`

- [ ] **Step 1: Create HTML fixture**

Create `tests/fixtures/pond-phuwin-event.html` with this minimal fixture:

```html
<section id="section-event-round">
  <div class="event-detail-item">
    <div class="box-txt"><a class="venue">อิมแพ็ค อารีน่า เมืองทองธานี</a></div>
    <div class="box-event-list">
      <div class="row">
        <div class="col-label"><div class="date">วันศุกร์ที่ 21 สิงหาคม 2569</div></div>
        <div class="col-btn"><span class="btn-item"><a data-button="9253" href="javascript:;" class="btn" disabled><span class="item-show">18:00</span></a></span></div>
      </div>
    </div>
  </div>
  <div class="event-detail-item">
    <div class="box-txt"><a class="venue">Live Streaming by TTM LIVE</a></div>
    <div class="box-event-list">
      <div class="row">
        <div class="col-label"><div class="date">วันศุกร์ที่ 21 สิงหาคม 2569</div></div>
        <div class="col-btn"><span class="btn-item"><a data-button="9254" href="javascript:;" class="btn" disabled><span class="item-show">18:00</span></a></span></div>
      </div>
    </div>
  </div>
  <div class="event-detail-item">
    <div class="box-txt"><a class="venue">RERUN by TTM LIVE</a></div>
    <div class="box-event-list">
      <div class="row">
        <div class="col-label"><div class="date">(Rerun) รอบการแสดงวันศุกร์ที่ 21 สิงหาคม 2569</div></div>
        <div class="col-btn"><span class="btn-item"><a data-button="9255" href="javascript:;" class="btn" disabled><span class="item-show">10:00</span></a></span></div>
      </div>
    </div>
  </div>
</section>
```

- [ ] **Step 2: Write failing resolver tests**

Create `tests/targetRound.test.ts`:

```ts
import { readFileSync } from "node:fs";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { resolveTargetRoundOnPage } from "../src/bot/targetRound.ts";

const fixture = readFileSync(path.join(process.cwd(), "tests/fixtures/pond-phuwin-event.html"), "utf8");

describe("resolveTargetRoundOnPage", () => {
  let browser: Browser;
  let page: Page;

  beforeAll(async () => {
    browser = await chromium.launch({ headless: true });
  });

  beforeEach(async () => {
    page = await browser.newPage();
    await page.setContent(fixture);
  });

  afterAll(async () => {
    await browser.close();
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

  it("returns undefined when exact target is missing", async () => {
    const result = await resolveTargetRoundOnPage(page, {
      date: "2026-08-22",
      time: "18:00",
      type: "offline",
    });

    expect(result).toBeUndefined();
  });
});
```

- [ ] **Step 3: Run test to verify failure**

```bash
npm test -- tests/targetRound.test.ts
```

Expected: fail because `src/bot/targetRound.ts` does not exist.

- [ ] **Step 4: Implement resolver**

Create `src/bot/targetRound.ts`:

```ts
import type { Page } from "playwright";
import type { TargetRound } from "../config/schema.ts";

export type TargetRoundState = {
  dataButton: string;
  dateText: string;
  timeText: string;
  type: "offline" | "live_streaming" | "rerun" | "any";
  disabled: boolean;
  href: string;
  onclick: string;
  label: string;
  queueOrBookingCapable: boolean;
};

export async function resolveTargetRoundOnPage(page: Page, target: TargetRound): Promise<TargetRoundState | undefined> {
  return page.evaluate((targetRound) => {
    const classifyItem = (item: Element): "offline" | "live_streaming" | "rerun" => {
      const text = (item.textContent ?? "").toLowerCase();
      if (text.includes("rerun")) return "rerun";
      if (text.includes("live streaming") || text.includes("ttm live")) return "live_streaming";
      return "offline";
    };
    const rows = Array.from(document.querySelectorAll(".event-detail-item")).flatMap((item) => {
      const type = classifyItem(item);
      return Array.from(item.querySelectorAll(".box-event-list .row")).map((row) => ({ item, row, type }));
    });
    const matchesDate = (dateText: string, date: string) => {
      const thaiDateMap: Record<string, string> = {
        "2026-08-21": "21 สิงหาคม 2569",
        "2026-08-22": "22 สิงหาคม 2569",
        "2026-08-23": "23 สิงหาคม 2569",
      };
      return dateText.includes(thaiDateMap[date] ?? date);
    };
    for (const { row, type } of rows) {
      if (targetRound.type !== "any" && type !== targetRound.type) continue;
      const dateText = row.querySelector(".date")?.textContent?.trim() ?? "";
      const button = row.querySelector<HTMLAnchorElement>("a.btn[data-button]");
      const timeText = button?.querySelector(".item-show")?.textContent?.trim() ?? "";
      if (!button || !matchesDate(dateText, targetRound.date) || timeText !== targetRound.time) continue;
      const href = button.getAttribute("href") ?? "";
      const onclick = button.getAttribute("onclick") ?? "";
      const label = button.textContent?.trim() ?? "";
      const disabled = button.hasAttribute("disabled");
      const navEvidence = `${href} ${onclick} ${label}`.toLowerCase();
      return {
        dataButton: button.getAttribute("data-button") ?? "",
        dateText,
        timeText,
        type: targetRound.type === "any" ? type : targetRound.type,
        disabled,
        href,
        onclick,
        label,
        queueOrBookingCapable: !disabled && (navEvidence.includes("queue") || navEvidence.includes("zones.php") || navEvidence.includes("booking")),
      };
    }
    return undefined;
  }, target);
}
```

- [ ] **Step 5: Verify tests**

```bash
npm test -- tests/targetRound.test.ts
npm run typecheck
```

Expected: tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/bot/targetRound.ts tests/fixtures/pond-phuwin-event.html tests/targetRound.test.ts
git commit -m "feat: resolve exact target round"
```

## Task 3: Queue Watcher Schedule

**Files:**
- Create: `src/bot/queueSchedule.ts`
- Create: `tests/queueSchedule.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/queueSchedule.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { nextReloadDelayMs, botReloadOffsetMs, watcherDeadline } from "../src/bot/queueSchedule.ts";

describe("queueSchedule", () => {
  it("uses burst then 10s cadence", () => {
    expect([0, 1, 2, 3, 4, 5].map(nextReloadDelayMs)).toEqual([0, 1000, 3000, 5000, 10000, 20000]);
    expect(nextReloadDelayMs(6)).toBe(30000);
  });

  it("stagger bots by 150ms", () => {
    expect(botReloadOffsetMs(1)).toBe(0);
    expect(botReloadOffsetMs(2)).toBe(150);
    expect(botReloadOffsetMs(5)).toBe(600);
  });

  it("sets deadline to sale start plus ten minutes", () => {
    const deadline = watcherDeadline("2026-06-28T10:00:00+07:00");
    expect(deadline.toISOString()).toBe("2026-06-28T03:10:00.000Z");
  });
});
```

- [ ] **Step 2: Run test to verify failure**

```bash
npm test -- tests/queueSchedule.test.ts
```

Expected: fail because module missing.

- [ ] **Step 3: Implement helper**

Create `src/bot/queueSchedule.ts`:

```ts
const BURST_MS = [0, 1000, 3000, 5000, 10000];

export function nextReloadDelayMs(attemptIndex: number): number {
  if (attemptIndex < BURST_MS.length) return BURST_MS[attemptIndex] ?? 0;
  return 10000 + (attemptIndex - BURST_MS.length + 1) * 10000;
}

export function botReloadOffsetMs(botId: number): number {
  return Math.max(0, botId - 1) * 150;
}

export function watcherDeadline(saleStartIso: string): Date {
  const saleStart = new Date(saleStartIso);
  if (Number.isNaN(saleStart.getTime())) throw new Error(`Invalid sale_start: ${saleStartIso}`);
  return new Date(saleStart.getTime() + 10 * 60 * 1000);
}
```

- [ ] **Step 4: Verify tests**

```bash
npm test -- tests/queueSchedule.test.ts
npm run typecheck
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add src/bot/queueSchedule.ts tests/queueSchedule.test.ts
git commit -m "feat: add queue watcher schedule"
```

## Task 4: Forensic Run Logger

**Files:**
- Create: `src/bot/forensics.ts`
- Create: `tests/forensics.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/forensics.test.ts`:

```ts
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createRunForensics, redactForArtifact } from "../src/bot/forensics.ts";

describe("forensics", () => {
  it("creates run folder and writes JSONL events", () => {
    const root = mkdtempSync(path.join(tmpdir(), "ttm-forensics-"));
    const fx = createRunForensics({
      artifactRoot: root,
      runId: "2026-06-28T085900+0700",
      botCount: 5,
      targetRound: { date: "2026-08-21", time: "18:00", type: "offline" },
      queueStart: "2026-06-28T09:00:00+07:00",
      saleStart: "2026-06-28T10:00:00+07:00",
    });

    fx.event({ botId: 1, state: "READY", url: "https://example.test", pageKind: "event", action: "target_resolved", result: "ok" });

    const eventLines = readFileSync(path.join(root, "2026-06-28T085900+0700", "events.jsonl"), "utf8").trim().split("\n");
    expect(eventLines).toHaveLength(1);
    expect(JSON.parse(eventLines[0]).action).toBe("target_resolved");
  });

  it("redacts secrets and personal data", () => {
    const redacted = redactForArtifact({
      email: "a@example.com",
      citizenId: "1234567890123",
      headers: { cookie: "secret", authorization: "Bearer x" },
      nested: { password: "pw", TELEGRAM_TOKEN: "tok" },
    });

    expect(JSON.stringify(redacted)).not.toContain("a@example.com");
    expect(JSON.stringify(redacted)).not.toContain("1234567890123");
    expect(JSON.stringify(redacted)).not.toContain("Bearer x");
  });
});
```

- [ ] **Step 2: Run test to verify failure**

```bash
npm test -- tests/forensics.test.ts
```

Expected: fail because module missing.

- [ ] **Step 3: Implement forensics module**

Create `src/bot/forensics.ts`:

```ts
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Page } from "playwright";
import type { TargetRound } from "../config/schema.ts";

export type RunForensicsOptions = {
  artifactRoot: string;
  runId: string;
  botCount: number;
  targetRound?: TargetRound;
  queueStart?: string;
  saleStart?: string;
};

export type ForensicEvent = {
  botId?: number;
  state: string;
  url?: string;
  pageKind?: string;
  action: string;
  result: string;
  targetRound?: unknown;
  selector?: string;
  error?: string;
  stack?: string;
};

export type RunForensics = {
  runDir: string;
  event: (event: ForensicEvent) => void;
  botDir: (botId: number) => string;
  captureDecision: (botId: number, page: Page, label: string) => Promise<void>;
};

export function createRunForensics(options: RunForensicsOptions): RunForensics {
  const runDir = path.join(options.artifactRoot, options.runId);
  mkdirSync(runDir, { recursive: true });
  writeFileSync(path.join(runDir, "run.json"), JSON.stringify(redactForArtifact(options), null, 2));
  const startedAt = Date.now();
  let sequence = 0;

  const botDir = (botId: number) => {
    const dir = path.join(runDir, `bot-${botId}`);
    mkdirSync(dir, { recursive: true });
    return dir;
  };

  return {
    runDir,
    botDir,
    event(event) {
      const payload = redactForArtifact({
        ts: new Date().toISOString(),
        elapsedMs: Date.now() - startedAt,
        ...event,
      });
      appendFileSync(path.join(runDir, "events.jsonl"), `${JSON.stringify(payload)}\n`);
    },
    async captureDecision(botId, page, label) {
      const dir = botDir(botId);
      const prefix = `${String(++sequence).padStart(3, "0")}-${safeLabel(label)}`;
      await page.screenshot({ path: path.join(dir, `${prefix}.png`), fullPage: true }).catch(() => undefined);
      const html = await page.content().catch(() => "");
      writeFileSync(path.join(dir, `${prefix}.html`), redactHtml(html));
    },
  };
}

export function attachForensicListeners(page: Page, run: RunForensics, botId: number): void {
  page.on("requestfailed", (request) => {
    appendFileSync(path.join(run.botDir(botId), "network.jsonl"), `${JSON.stringify(redactForArtifact({
      ts: new Date().toISOString(),
      type: "requestfailed",
      url: request.url(),
      method: request.method(),
      failure: request.failure()?.errorText,
    }))}\n`);
  });
  page.on("response", (response) => {
    if (response.status() < 400) return;
    appendFileSync(path.join(run.botDir(botId), "network.jsonl"), `${JSON.stringify(redactForArtifact({
      ts: new Date().toISOString(),
      type: "response",
      url: response.url(),
      status: response.status(),
    }))}\n`);
  });
  page.on("pageerror", (error) => {
    appendFileSync(path.join(run.botDir(botId), "console.jsonl"), `${JSON.stringify(redactForArtifact({
      ts: new Date().toISOString(),
      type: "pageerror",
      message: error.message,
      stack: error.stack,
    }))}\n`);
  });
  page.on("console", (message) => {
    if (!["warning", "error"].includes(message.type())) return;
    appendFileSync(path.join(run.botDir(botId), "console.jsonl"), `${JSON.stringify(redactForArtifact({
      ts: new Date().toISOString(),
      type: message.type(),
      text: message.text(),
    }))}\n`);
  });
}

export function redactForArtifact<T>(value: T): T {
  return JSON.parse(JSON.stringify(value, (key, val) => {
    const lower = key.toLowerCase();
    if (["password", "cookie", "authorization"].includes(lower)) return "[REDACTED]";
    if (lower.includes("token") || lower.includes("chat_id") || lower.includes("citizen") || lower.includes("email")) return "[REDACTED]";
    return val;
  })) as T;
}

function redactHtml(html: string): string {
  return html
    .replace(/(name=["']password["'][^>]*value=["'])[^"']*/gi, "$1[REDACTED]")
    .replace(/(name=["']citizen[^"']*["'][^>]*value=["'])[^"']*/gi, "$1[REDACTED]")
    .replace(/(name=["']email["'][^>]*value=["'])[^"']*/gi, "$1[REDACTED]");
}

function safeLabel(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
```

- [ ] **Step 4: Verify tests**

```bash
npm test -- tests/forensics.test.ts
npm run typecheck
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add src/bot/forensics.ts tests/forensics.test.ts
git commit -m "feat: add forensic run logging"
```

## Task 5: Manual Intervention Detector

**Files:**
- Create: `src/bot/manualIntervention.ts`
- Create: `tests/manualIntervention.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/manualIntervention.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { classifyManualIntervention, transitionManualIntervention } from "../src/bot/manualIntervention.ts";

describe("manualIntervention", () => {
  it("detects image captcha", () => {
    const result = classifyManualIntervention({
      url: "https://www.thaiticketmajor.com/8860/verify_2720_captcha",
      html: '<form action="/verify_2720_captcha"><img class="yz"></form>',
    });

    expect(result).toEqual({ present: true, reason: "captcha" });
  });

  it("detects verify page", () => {
    const result = classifyManualIntervention({
      url: "https://booking.thaiticketmajor.com/booking/3m/verify.php",
      html: "<html></html>",
    });

    expect(result).toEqual({ present: true, reason: "verify" });
  });

  it("alerts only when visibility changes false to true", () => {
    expect(transitionManualIntervention(false, true)).toBe("appeared");
    expect(transitionManualIntervention(true, true)).toBe("unchanged");
    expect(transitionManualIntervention(true, false)).toBe("cleared");
  });
});
```

- [ ] **Step 2: Run test to verify failure**

```bash
npm test -- tests/manualIntervention.test.ts
```

Expected: fail because module missing.

- [ ] **Step 3: Implement detector**

Create `src/bot/manualIntervention.ts`:

```ts
import type { Page } from "playwright";

export type ManualInterventionReason = "captcha" | "verify" | "terms" | "unknown_page";
export type ManualInterventionState = { present: false } | { present: true; reason: ManualInterventionReason };
export type ManualInterventionTransition = "appeared" | "cleared" | "unchanged";

export function classifyManualIntervention(input: { url: string; html: string }): ManualInterventionState {
  const url = input.url.toLowerCase();
  const html = input.html.toLowerCase();
  if (url.includes("captcha") || html.includes('class="yz"') || html.includes("_captcha") || html.includes("google.com/recaptcha") || html.includes("challenges.cloudflare.com") || html.includes("cf-turnstile") || html.includes("geetest") || html.includes("puzzle-slider")) {
    return { present: true, reason: "captcha" };
  }
  if (url.includes("verify.php") || url.includes("verify_condition.php")) {
    return { present: true, reason: "verify" };
  }
  if (html.includes("btn_confirmpolicy") || html.includes("rdagree")) {
    return { present: true, reason: "terms" };
  }
  return { present: false };
}

export async function detectManualInterventionOnPage(page: Page): Promise<ManualInterventionState> {
  const url = page.url();
  const html = await page.content().catch(() => "");
  return classifyManualIntervention({ url, html });
}

export function transitionManualIntervention(previousVisible: boolean, currentVisible: boolean): ManualInterventionTransition {
  if (!previousVisible && currentVisible) return "appeared";
  if (previousVisible && !currentVisible) return "cleared";
  return "unchanged";
}
```

- [ ] **Step 4: Verify tests**

```bash
npm test -- tests/manualIntervention.test.ts
npm run typecheck
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add src/bot/manualIntervention.ts tests/manualIntervention.test.ts
git commit -m "feat: detect manual intervention"
```

## Task 6: Queue Hold Manual-Intervention State

**Files:**
- Modify: `src/bot/pages/queue.ts`
- Test: add tests only if current queue tests exist; otherwise cover through `manualIntervention.test.ts` and worker integration later.

- [ ] **Step 1: Replace one-shot CAPTCHA state in queue hold**

Modify `src/bot/pages/queue.ts` to import:

```ts
import { detectManualInterventionOnPage, transitionManualIntervention } from "../manualIntervention.ts";
```

Replace `captchaAlerted` loop logic with:

```ts
let manualVisible = false;

while (page.url().includes(queue_url_pattern) && Date.now() < deadline) {
  const manual = await detectManualInterventionOnPage(page);
  const transition = transitionManualIntervention(manualVisible, manual.present);
  if (transition === "appeared" && manual.present) {
    manualVisible = true;
    const message = `Bot ${botId}: manual intervention (${manual.reason}) - solve in browser`;
    emit({ type: "state", botId, state: "MANUAL_INTERVENTION", detail: manual.reason });
    emit({ type: "alert", botId, kind: "manual_intervention", message });
    await notifyBestEffort(notifier, message, emit, botId);
  }
  if (transition === "cleared") {
    manualVisible = false;
    emit({ type: "log", botId, message: "manual intervention cleared" });
    emit({ type: "state", botId, state: "IN_QUEUE", detail: "Holding queue" });
  }
  await sleep(jitter(800, 1200));
}
```

- [ ] **Step 2: Update IPC types**

In `src/ipc/types.ts`, add bot state and alert kind:

```ts
| "ARMED"
| "WATCHING_QUEUE_OPEN"
| "MANUAL_INTERVENTION"
```

Add alert kind:

```ts
| "manual_intervention"
```

- [ ] **Step 3: Run verification**

```bash
npm run typecheck
npm test -- tests/manualIntervention.test.ts
```

Expected: pass.

- [ ] **Step 4: Commit**

```bash
git add src/bot/pages/queue.ts src/ipc/types.ts
git commit -m "feat: pause queue on manual intervention"
```

## Task 7: Worker Prepare and Queue-Ready Watcher

**Files:**
- Modify: `src/bot/worker.ts`
- Depends on: Tasks 2-6

- [ ] **Step 1: Add helper imports**

In `src/bot/worker.ts`, add:

```ts
import { resolveTargetRoundOnPage, type TargetRoundState } from "./targetRound.ts";
import { botReloadOffsetMs, nextReloadDelayMs, watcherDeadline } from "./queueSchedule.ts";
import { detectManualInterventionOnPage, transitionManualIntervention } from "./manualIntervention.ts";
```

- [ ] **Step 2: Fail prepare when `target_round` missing**

Modify `prepare()`:

```ts
async function prepare(): Promise<void> {
  const p = requirePage();
  emit({ type: "log", botId: init.botId, message: "loading event page" });
  await p.goto(init.config.concert.event_url, { waitUntil: "domcontentloaded" });
  const target = await requireTargetRound(p);
  emit({
    type: "state",
    botId: init.botId,
    state: "READY",
    detail: `target=${target.type} ${init.config.concert.target_round?.date} ${target.timeText} ${target.disabled ? "disabled" : "enabled"}`,
  });
}
```

Add helper:

```ts
async function requireTargetRound(p: Page): Promise<TargetRoundState> {
  const targetRound = init.config.concert.target_round;
  if (!targetRound) throw new Error("target_round is required for queue-ready mode");
  const target = await resolveTargetRoundOnPage(p, targetRound);
  if (!target) throw new Error(`Target round not found: ${targetRound.type} ${targetRound.date} ${targetRound.time}`);
  return target;
}
```

- [ ] **Step 3: Add arm command handler in worker**

After command checks:

```ts
if (command.type === "arm") await arm();
```

Add:

```ts
async function arm(): Promise<void> {
  const p = requirePage();
  await p.goto(init.config.concert.event_url, { waitUntil: "domcontentloaded" });
  await requireTargetRound(p);
  emit({ type: "state", botId: init.botId, state: "ARMED", detail: "Queue-ready checks passed" });
}
```

- [ ] **Step 4: Replace `go()` buy-button click with queue-ready watcher**

Change `go()`:

```ts
async function go(scheduledFor?: string): Promise<void> {
  const p = requirePage();
  emit({
    type: "state",
    botId: init.botId,
    state: "WATCHING_QUEUE_OPEN",
    detail: scheduledFor ? `Started by timer ${scheduledFor}` : "Started manually",
  });
  await p.goto(init.config.concert.event_url, { waitUntil: "domcontentloaded" });
  await watchTargetUntilQueueOrBooking(p);
  await handleCurrentPage();
}
```

Add:

```ts
async function watchTargetUntilQueueOrBooking(p: Page): Promise<void> {
  const saleStart = init.config.concert.sale_start;
  if (!saleStart) throw new Error("sale_start is required for queue watcher");
  const deadline = watcherDeadline(saleStart).getTime();
  let reloadAttempt = 0;
  let nextReloadAt = Date.now() + botReloadOffsetMs(init.botId);
  let manualVisible = false;

  while (Date.now() < deadline && !stopped) {
    const kind = classifyPage(p.url());
    if (kind === "queue" || kind === "zones" || kind === "fixed") return;

    const manual = await detectManualInterventionOnPage(p);
    const transition = transitionManualIntervention(manualVisible, manual.present);
    if (transition === "appeared" && manual.present) {
      manualVisible = true;
      const message = `Bot ${init.botId}: manual intervention (${manual.reason}) - solve in browser`;
      emit({ type: "state", botId: init.botId, state: "MANUAL_INTERVENTION", detail: manual.reason });
      emit({ type: "alert", botId: init.botId, kind: "manual_intervention", message });
      await notifyBestEffort(message);
    }
    if (manual.present) {
      await sleep(1000);
      continue;
    }
    if (transition === "cleared") {
      manualVisible = false;
      emit({ type: "state", botId: init.botId, state: "WATCHING_QUEUE_OPEN", detail: "Manual step cleared" });
    }

    if (Date.now() >= nextReloadAt) {
      await p.reload({ waitUntil: "domcontentloaded" }).catch(() => undefined);
      nextReloadAt = Date.now() + nextReloadDelayMs(++reloadAttempt);
    }

    const target = await requireTargetRound(p);
    if (target.queueOrBookingCapable) {
      await clickTargetRound(p, target);
      return;
    }
    await sleep(300 + Math.random() * 200);
  }
  throw new Error(`Queue watcher timed out at ${new Date().toISOString()}`);
}
```

Add click helper:

```ts
async function clickTargetRound(p: Page, target: TargetRoundState): Promise<void> {
  const selector = `a.btn[data-button="${target.dataButton}"]`;
  emit({ type: "log", botId: init.botId, message: `clicking target round ${selector}` });
  await p.locator(selector).first().click({ timeout: 3000 });
  await p.waitForLoadState("domcontentloaded", { timeout: 10000 }).catch(() => undefined);
}
```

Add local sleep near bottom:

```ts
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
```

- [ ] **Step 5: Remove or stop using `clickBuyNowIfPresent`**

Delete `clickBuyNowIfPresent` only after typecheck confirms no callers. If keeping for backward compatibility, do not call it from `go()`.

- [ ] **Step 6: Verify**

```bash
npm run typecheck
npm test -- tests/targetRound.test.ts tests/queueSchedule.test.ts tests/manualIntervention.test.ts
```

Expected: pass.

- [ ] **Step 7: Commit**

```bash
git add src/bot/worker.ts
git commit -m "feat: watch exact target for queue entry"
```

## Task 8: IPC Command and Main Scheduling

**Files:**
- Modify: `src/ipc/types.ts`
- Modify: `src/ipc/commands.ts`
- Modify: `src/main.ts`
- Test: `tests/commands.test.ts`

- [ ] **Step 1: Write failing command test**

Add to `tests/commands.test.ts`:

```ts
it("parses arm command", () => {
  expect(parseCommand("arm all")).toEqual({ type: "arm", target: "all" });
  expect(parseCommand("arm 3")).toEqual({ type: "arm", target: 3 });
});
```

- [ ] **Step 2: Run failing test**

```bash
npm test -- tests/commands.test.ts
```

Expected: fail with `Unknown command: arm`.

- [ ] **Step 3: Add IPC types**

In `src/ipc/types.ts`, add to `BotCommand`:

```ts
| { type: "arm" }
```

Add to `MainCommand`:

```ts
| { type: "arm"; target: CommandTarget }
```

- [ ] **Step 4: Parse `arm`**

In `src/ipc/commands.ts`:

```ts
const TARGET_COMMANDS = new Set(["prepare", "go", "arm", "stop", "reset", "assign", "log"]);
```

- [ ] **Step 5: Dispatch `arm` from main**

In `src/main.ts`, update `toBotCommand`:

```ts
if (command.type === "arm") return { type: "arm" };
```

Add handling before generic dispatch:

```ts
if (command.type === "arm") {
  validateQueueReadyConfig();
}
```

Add:

```ts
function validateQueueReadyConfig(): void {
  const { target_round, queue_start, sale_start } = config.concert;
  if (!target_round) throw new Error("target_round is required before arm");
  if (!queue_start) throw new Error("queue_start is required before arm");
  if (!sale_start) throw new Error("sale_start is required before arm");
  const queue = new Date(queue_start);
  const sale = new Date(sale_start);
  if (Number.isNaN(queue.getTime())) throw new Error(`Invalid queue_start: ${queue_start}`);
  if (Number.isNaN(sale.getTime())) throw new Error(`Invalid sale_start: ${sale_start}`);
  if (queue.getTime() >= sale.getTime()) throw new Error("queue_start must be before sale_start");
}
```

- [ ] **Step 6: Schedule `go` at queue_start when arming**

After sending `arm` command, schedule `go`:

```ts
function scheduleQueueStart(target: CommandTarget): void {
  const queueStart = config.concert.queue_start;
  if (!queueStart) throw new Error("queue_start is required");
  const start = new Date(queueStart);
  if (scheduledTimer) clearTimeout(scheduledTimer);
  scheduledStart = start.toLocaleString();
  scheduledTimer = setTimeout(() => {
    addLog(undefined, "queue_start fired");
    for (const botId of resolveTargets(target, [...workers.keys()])) {
      workers.get(botId)?.send({ type: "go", scheduledFor: scheduledStart });
    }
    scheduledStart = undefined;
    renderApp();
  }, Math.max(0, start.getTime() - Date.now()));
  addLog(undefined, `armed queue start at ${scheduledStart}`);
}
```

Call `scheduleQueueStart(command.target)` after broadcasting arm.

- [ ] **Step 7: Verify**

```bash
npm test -- tests/commands.test.ts
npm run typecheck
```

Expected: pass.

- [ ] **Step 8: Commit**

```bash
git add src/ipc/types.ts src/ipc/commands.ts src/main.ts tests/commands.test.ts
git commit -m "feat: add arm command"
```

## Task 9: Integrate Forensics in Worker

**Files:**
- Modify: `src/ipc/types.ts`
- Modify: `src/bot/worker.ts`
- Modify: `src/main.ts`

- [ ] **Step 1: Pass run id to workers**

In `src/ipc/types.ts`, extend `WorkerInit`:

```ts
runId?: string;
```

In `src/main.ts`, compute:

```ts
const runId = formatRunId(new Date());
```

Add helper:

```ts
function formatRunId(date: Date): string {
  const tzOffset = -date.getTimezoneOffset();
  const sign = tzOffset >= 0 ? "+" : "-";
  const hh = String(Math.floor(Math.abs(tzOffset) / 60)).padStart(2, "0");
  const mm = String(Math.abs(tzOffset) % 60).padStart(2, "0");
  return `${date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "")}${sign}${hh}${mm}`;
}
```

Pass `runId` in `workerData`.

- [ ] **Step 2: Create run forensics in worker**

In `src/bot/worker.ts`, import:

```ts
import { attachForensicListeners, createRunForensics, type RunForensics } from "./forensics.ts";
```

Add:

```ts
let forensics: RunForensics | undefined;
```

In `main()` before launch or after init:

```ts
if (init.config.concert.observability.mode === "forensic" && init.runId) {
  forensics = createRunForensics({
    artifactRoot: path.join(init.config.rootDir, init.config.concert.observability.artifact_root),
    runId: init.runId,
    botCount: init.totalBots,
    targetRound: init.config.concert.target_round,
    queueStart: init.config.concert.queue_start,
    saleStart: init.config.concert.sale_start,
  });
}
```

After `page` is created in `launch()`:

```ts
if (forensics) attachForensicListeners(page, forensics, init.botId);
```

- [ ] **Step 3: Capture decision points**

Add helper:

```ts
async function captureDecision(label: string): Promise<void> {
  if (!forensics || !page) return;
  await forensics.captureDecision(init.botId, page, label);
}
```

Call:

```ts
await captureDecision("preflight-target");
await captureDecision("before-target-click");
await captureDecision("after-target-click");
await captureDecision("queue-entered");
await captureDecision("manual-intervention-appears");
await captureDecision("manual-intervention-clears");
await captureDecision("before-seat-selection");
await captureDecision("after-seat-selection");
```

Use exact labels at the decision points already present in `prepare()`, `clickTargetRound()`, `holdQueue()` integration, and `bookSeats()`.

- [ ] **Step 4: Write events**

Add helper:

```ts
function forensicEvent(action: string, result: string, extra: Record<string, unknown> = {}): void {
  forensics?.event({
    botId: init.botId,
    state: snapshotsStateSafe(),
    url: page?.url(),
    pageKind: page ? classifyPage(page.url()) : undefined,
    action,
    result,
    ...extra,
  });
}

function snapshotsStateSafe(): string {
  return "worker";
}
```

Use it around target resolve, click, queue entered, manual intervention, booking, no seats, done, errors.

- [ ] **Step 5: Verify**

```bash
npm run typecheck
npm test -- tests/forensics.test.ts
```

Expected: pass.

- [ ] **Step 6: Commit**

```bash
git add src/bot/worker.ts src/ipc/types.ts src/main.ts
git commit -m "feat: capture forensic run artifacts"
```

## Task 10: TUI States and README Runbook

**Files:**
- Modify: `src/tui/BotGrid.tsx`
- Modify: `README.md`

- [ ] **Step 1: Update BotGrid state labels if needed**

If `src/tui/BotGrid.tsx` maps state names manually, add:

```ts
ARMED: "cyan",
WATCHING_QUEUE_OPEN: "yellow",
MANUAL_INTERVENTION: "red",
```

If it already renders arbitrary state text without mapping, no code change required.

- [ ] **Step 2: Update README commands**

Add queue-ready runbook:

```md
## Queue-Ready Runbook

1. Configure `target_round`, `queue_start`, `sale_start`, and `observability` in `config/concert.yaml`.
2. Start five sessions:

```bash
npm run start -- --bots 5
```

3. Log in manually in every browser.
4. In TUI:

```text
prepare all
arm all
```

`prepare all` validates the exact target round. `arm all` schedules queue entry at `queue_start`.

Forensic artifacts are written under `bot_data/runs/<run-id>/` when `observability.mode` is `forensic`.
```

- [ ] **Step 3: Verify docs and typecheck**

```bash
npm run typecheck
npm test
```

Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add src/tui/BotGrid.tsx README.md
git commit -m "docs: add queue-ready runbook"
```

## Final Verification

- [ ] **Step 1: Run full test suite**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 2: Run typecheck**

```bash
npm run typecheck
```

Expected: no TypeScript errors.

- [ ] **Step 3: Start local TUI smoke test**

```bash
npm run start -- --bots 1
```

Expected:

- browser launches
- TUI accepts `prepare all`
- target round resolves or fails with a clear target/config error
- TUI accepts `arm all`
- if queue_start is in future, scheduled start appears

- [ ] **Step 4: Inspect forensic artifact smoke output**

If forensic mode enabled and smoke reaches prepare:

```bash
find bot_data/runs -maxdepth 3 -type f | tail -20
```

Expected: `run.json`, `events.jsonl`, and bot artifact folder exist.
