# Runtime Zone Priority Fast Empty-Zone Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add current-run zone priority updates and make unavailable-only fixed pages exit quickly.

**Architecture:** Add a `zone all|N ...` command that dispatches runtime priority updates to workers. `BookingService` owns runtime priority state and uses it for all zone choices. `FixedPageSeatSelector` waits for seat-map state instead of waiting only for available seats.

**Tech Stack:** TypeScript, worker_threads, Playwright page evaluation, Ink TUI, Vitest.

---

### Task 1: Command Parsing And IPC Types

**Files:**
- Modify: `src/ipc/types.ts`
- Modify: `src/ipc/commands.ts`
- Test: `tests/commands.test.ts`

- [ ] **Step 1: Write failing command parser tests**

Add tests:

```ts
it("parses runtime zone priority command", () => {
  expect(parseCommand("zone all SC SD SE")).toEqual({ type: "zone", target: "all", zones: ["SC", "SD", "SE"] });
  expect(parseCommand("zone 2 A2 A3")).toEqual({ type: "zone", target: 2, zones: ["A2", "A3"] });
});

it("rejects zone command without zones", () => {
  expect(() => parseCommand("zone all")).toThrow("Usage: zone all|N ZONE...");
  expect(() => parseCommand("zone 2")).toThrow("Usage: zone all|N ZONE...");
});
```

- [ ] **Step 2: Run failing parser tests**

Run: `npm test -- tests/commands.test.ts`

Expected: FAIL because `zone` is unknown.

- [ ] **Step 3: Add types and parser implementation**

Add `BotCommand` variant:

```ts
| { type: "set_zone_priority"; zones: string[] }
```

Add `MainCommand` variant:

```ts
| { type: "zone"; target: CommandTarget; zones: string[] }
```

Update parser to accept `zone all|N ZONE...` and reject empty zones.

- [ ] **Step 4: Run parser tests**

Run: `npm test -- tests/commands.test.ts`

Expected: PASS.

### Task 2: Main Dispatch And Runtime Handling

**Files:**
- Modify: `src/main.ts`
- Modify: `src/bot/runtime/BotRuntime.ts`

- [ ] **Step 1: Dispatch zone command**

Update `toBotCommand`:

```ts
if (command.type === "zone") return { type: "set_zone_priority", zones: command.zones };
```

Log command as `command: zone SC, SD, SE`.

- [ ] **Step 2: Runtime handles set-zone without blocking**

Handle `set_zone_priority` before `runningCommand` guard:

```ts
if (command.type === "set_zone_priority") {
  this.booking.setZonePriority(command.zones);
  return;
}
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`

Expected: PASS after Task 3 adds `setZonePriority`.

### Task 3: Booking Runtime Priority

**Files:**
- Modify: `src/bot/booking/BookingService.ts`
- Test: `tests/zonePriority.test.ts` or existing booking/router test if more direct.

- [ ] **Step 1: Add runtime priority state**

Add field:

```ts
private runtimeZonePriority: string[] | undefined;
```

Add method:

```ts
setZonePriority(zones: string[]): void {
  if (zones.length === 0) {
    this.options.emit({ type: "log", botId: this.options.botId, message: "zone priority update ignored: empty zone list" });
    return;
  }
  this.runtimeZonePriority = [...zones];
  this.zonesTried = new Set();
  this.zoneCycles = 0;
  this.options.forensics.event("zone-priority", "updated", { zones });
  this.options.emit({ type: "log", botId: this.options.botId, message: `zone priority updated: ${zones.join(", ")}` });
}
```

Add helper:

```ts
private effectiveZonePriority(): string[] {
  return this.runtimeZonePriority ?? this.options.concert.zone_priority;
}
```

- [ ] **Step 2: Use effective priority**

Replace every `this.options.concert.zone_priority` passed to `nextZoneAfter` with `this.effectiveZonePriority()`.

- [ ] **Step 3: Add focused test if practical**

Prefer command/runtime integration only if existing mocks make it cheap. Otherwise rely on typecheck plus existing zone tests because `BookingService` is Playwright-heavy.

### Task 4: Fast Empty-Zone Detection

**Files:**
- Modify: `src/bot/booking/FixedPageSeatSelector.ts`
- Test: `tests/fixed.test.ts`

- [ ] **Step 1: Write failing fixed-page wait tests**

Add a mock page test where `waitForFunction` resolves for map loaded and `evaluate` returns `{ status: "no_seats" }` once. Existing mock shape should verify no full retry wait is needed by expecting one evaluate call when retry limit is greater than one.

- [ ] **Step 2: Implement seat map wait helper**

Replace `waitForAvailableSeatDom` with `waitForSeatMapState`:

```ts
type SeatMapState = "available" | "unavailable_only" | "not_loaded";
```

Wait for any selector:

```ts
div[id^='checkseat-'], .seatnotavail, .seatuncheck, .seatchecked
```

After wait resolves, call `waitForTimeout(300)`, then evaluate `.seatuncheck` count.

- [ ] **Step 3: Use state in selector**

If state is `unavailable_only`, return `{ status: "no_seats" }` without calling the pick script. If state is `available`, call existing pick script. If not loaded, preserve existing navigation handling and return `no_seats` on fixed page.

- [ ] **Step 4: Run fixed tests**

Run: `npm test -- tests/fixed.test.ts`

Expected: PASS.

### Task 5: Verification

**Files:**
- Existing tests only.

- [ ] **Step 1: Run targeted tests**

Run:

```bash
npm test -- tests/commands.test.ts tests/fixed.test.ts tests/zonePriority.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run typecheck**

Run:

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 3: Run full tests**

Run:

```bash
npm test
```

Expected: PASS.
