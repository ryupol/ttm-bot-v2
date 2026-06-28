# TTM Queue Final Design

Status: final design before implementation.

Supersedes:

- `2026-06-27-queue-page-intelligence-design.md`
- `2026-06-27-queue-acquisition-redesign.md`

Keeps hard constraints:

- No CAPTCHA solving.
- No queue bypass.
- No proxy, identity, or browser fingerprint spoofing.
- No automatic terms, verification, payment, or CAPTCHA action.
- Queue-it visitor-presence confirmation may be auto-clicked only under strict queue guards.

## Current Code Problems

Current implementation still has timer/race assumptions:

- `src/main.ts` requires `queue_start` before `arm`.
- `src/main.ts` sends `arm`, waits for worker `ARMED`, then schedules `go` at `queue_start`.
- `src/bot/worker.ts` `go()` starts `watchTargetUntilQueueOrBooking()`.
- `watchTargetUntilQueueOrBooking()` stops at `watcherDeadline(sale_start)`, currently `sale_start + 10min`.
- `src/bot/pages/queue.ts` `holdQueue()` exits by `manual_solve_timeout`; real Queue-it wait can exceed this.
- `src/bot/pages/classifier.ts` only returns `queue` when URL includes `/queue`.

These conflict with real ThaiTicketMajor sale-day behavior:

- Real Queue-it wait URL is `https://wait.thaiticketmajor.com/view?...`.
- Real Gatekeeper inflow URL is `https://gatekeeper.thaiticketmajor.com/inflow/v2/?qid=...`.
- Real Gatekeeper CAPTCHA URL is `https://gatekeeper.thaiticketmajor.com/stacks/sep/?ks=...`.
- Late queue acquisition remains useful after `sale_start`.
- Once Queue-it is reached, reload/click retry must stop to preserve session.

## Final Model

Use one persistent acquisition state machine:

1. `prepare all` loads event page, validates login/session readiness, resolves exact `target_round`.
2. `arm all` validates config and starts acquisition immediately.
3. `go all` starts same acquisition loop immediately.
4. Acquisition loops until queue, booking, manual intervention, user stop, or fatal browser/page error.
5. Queue hold has no elapsed-time timeout. User `stop` is normal termination.
6. Queue-it visitor-presence modal is handled inside queue hold.

`queue_start` is no longer part of sale-day queue acquisition.

`sale_start` remains optional operational metadata, used only for cadence:

- Before sale: slower reload cadence.
- After sale: slightly faster reload cadence.
- Never as stop deadline.

## Page Signatures

Add `src/bot/pages/signatures.ts`.

Important correction: do not make `captcha` a `PageKind`. Current `PageKind` has no `captcha`, and CAPTCHA belongs to manual intervention. Signatures can produce either page classification or manual-intervention classification.

Shape:

```ts
import type { PageKind } from "./classifier.ts";
import type { ManualInterventionReason } from "../manualIntervention.ts";

export type PageSignature = {
  id: string;
  pageKind?: PageKind;
  manualReason?: ManualInterventionReason;
  host?: string;
  path?: RegExp;
  url?: RegExp;
  html?: string[];
};
```

Initial signatures:

```ts
export const PAGE_SIGNATURES: PageSignature[] = [
  {
    id: "queueit_wait",
    pageKind: "queue",
    host: "wait.thaiticketmajor.com",
    path: /^\/view/i,
    html: ["queueViewModel", "ticketmasterasia"],
  },
  {
    id: "gatekeeper_inflow",
    pageKind: "queue",
    host: "gatekeeper.thaiticketmajor.com",
    path: /^\/inflow\/v2/i,
  },
  {
    id: "gatekeeper_captcha",
    manualReason: "captcha",
    host: "gatekeeper.thaiticketmajor.com",
    path: /^\/stacks\/sep/i,
    html: ["CAPTCHA verification", "Verify You Are Human"],
  },
  {
    id: "queueit_presence_confirm",
    manualReason: "queue_presence_confirm",
    host: "wait.thaiticketmajor.com",
    html: ["buttonConfirmVisitorPresence", "Still here?"],
  },
];
```

Matching rules:

- URL/host/path match works without HTML when signature has no required HTML.
- If signature has HTML markers and HTML is available, require marker match for high-confidence event metadata.
- Gatekeeper CAPTCHA may alert from host/path alone because outcome is manual-only and safe.
- Queue-it wait can classify from host/path alone, then log marker presence when HTML confirms.

## Classification

Keep existing `classifyPage(url)` behavior for URL-only callers, but add optional HTML:

```ts
export function classifyPage(url: string, html?: string): PageKind
```

Order:

1. Existing URL rules for login, verify, zones, fixed, payment, enroll, error, event, home.
2. Queue signatures:
   - `wait.thaiticketmajor.com/view`
   - `gatekeeper.thaiticketmajor.com/inflow/v2`
   - Queue-it HTML markers when URL alone is unknown.
3. Existing `/queue` fallback for compatibility.
4. `unknown`.

Do not classify CAPTCHA through `classifyPage()`. Manual detector owns it.

Add helper:

```ts
export async function classifyCurrentPage(page: Page): Promise<PageKind>
```

It should:

- Run URL-only classification first.
- If result is conclusive, return it.
- If result is `unknown` or queue-sensitive, fetch `page.content()` best-effort and retry with HTML.

## Manual Intervention

Extend reason type:

```ts
export type ManualInterventionReason =
  | "captcha"
  | "verify"
  | "terms"
  | "unknown_page"
  | "queue_presence_confirm";
```

`classifyManualIntervention({ url, html })` uses signatures before generic CAPTCHA heuristics:

- `gatekeeper_captcha` -> `{ present: true, reason: "captcha" }`
- existing CAPTCHA heuristics remain
- verify URLs -> `verify`
- visible terms controls -> `terms`

`queue_presence_confirm` is not normal detection result. It is emitted only when guarded auto-click fails or is disabled. Successful presence click stays queue state.

Unknown handling stays separate:

```ts
classifyUnknownManualPage({ url, knownPage: false })
```

## Acquisition Loop

Replace `watchTargetUntilQueueOrBooking()` with `runQueueAcquisition()`.

Inputs:

- `page`
- `concert`
- `settings`
- `botId`
- `emit`
- `forensics`
- `shouldStop`

Behavior:

1. Navigate to `concert.event_url`.
2. Emit `WATCHING_QUEUE_OPEN`.
3. Classify current page with `classifyCurrentPage()`.
4. If queue-like, enter `holdQueue()`.
5. If booking-like (`zones`, `fixed`, `payment`), return to `handleCurrentPage()`.
6. If manual page, alert once and preserve page.
7. If unknown, capture screenshot/HTML, alert manual, preserve page.
8. Resolve exact `target_round`.
9. If target is queue-or-booking capable, click once.
10. Wait 2-3 seconds for navigation, URL change, or page-kind change.
11. If still on event page, resume DOM polling and scheduled reloads.
12. Repeat until queue, booking, manual intervention, `stop`, or fatal browser/page error.

No acquisition deadline.

Target click rule:

- One click per eligibility observation.
- After click, wait for page change.
- Retry only if page remains event page.
- Do not click again after reaching Queue-it/Gatekeeper.

Manual page rule:

- CAPTCHA, verify, terms, unknown preserve browser page.
- Emit one alert per appearance.
- `assign N` resumes from current page after user solves.

## Cadence

Replace current burst schedule with sale-aware cadence:

```ts
export function nextAcquisitionReloadDelayMs(now: Date, saleStartIso?: string, botId?: number): number
```

Rules:

- Before `sale_start`: reload every 10-15 seconds.
- After `sale_start`: reload every 5-10 seconds.
- DOM poll / click eligibility: every 500 ms.
- Add per-bot jitter/offset to avoid synchronized reloads.
- If `sale_start` missing, use pre-sale cadence and label status as acquisition.

Remove `watcherDeadline()`.

## Arm And Go Commands

`arm all`:

- Validate `target_round`.
- Validate `sale_start` only if present and parseable.
- Send `{ type: "arm" }` to target workers.
- Worker runs acquisition immediately after target validation.
- No pending queue-start map.
- No queue-start timer.
- No `ARMED` wait-gate needed.

`go all`:

- Start same acquisition loop immediately.
- Useful manual override.

`set-time HH:MM:SS`:

- Can stay as generic scheduled `go all`.
- Not part of queue-ready sale-day path.
- TUI text should avoid implying `set-time` is required.

Config:

- Keep schema accepting legacy `queue_start` optional during migration.
- Remove `queue_start` from required `arm` validation.
- Remove `queue_start` from sample sale-day configs and README.
- Keep `sale_start` optional.

## Queue Hold

Change `holdQueue()` contract so it is stop-driven, not timeout-driven.

Suggested shape:

```ts
export type HoldQueueOptions = {
  shouldStop?: () => boolean;
  forensics?: QueueForensicCallbacks;
  presenceConfirm?: QueuePresenceConfirmOptions;
};
```

Queue loop condition:

- while current page classifies as queue-like
- and `shouldStop()` is false
- and browser/page remains usable

Exit conditions:

- booking page -> return to `handleCurrentPage()`
- manual page -> alert and preserve page
- stop -> return without error
- fatal browser/page error -> throw

No queue timeout. No reload while queue-like.

`manual_solve_timeout` remains for specific manual wait operations, such as `assign` waiting for `fixed.php`; it must not cap queue wait.

## Visitor Presence Confirm

Implement in `holdQueue()`.

Strict guards:

- current host is `wait.thaiticketmajor.com`
- current page classifies as `queue`
- selector `#buttonConfirmVisitorPresence` visible and enabled
- modal/button text includes known markers:
  - `Still here?`
  - `Please confirm you're still waiting`
  - `Yes, I'm here`

Behavior:

1. Detect modal.
2. Capture `queue-presence-confirm-before-click`.
3. Emit event `queue-presence-confirm detected`.
4. Click `#buttonConfirmVisitorPresence`.
5. Wait briefly for one of:
   - button text changes to `Thanks`
   - modal hidden
   - button disabled
6. Capture `queue-presence-confirm-after-click`.
7. Emit event `queue-presence-confirm clicked`.
8. Continue queue hold.

Rate limits:

- minimum 30 seconds between clicks per bot/session
- maximum 20 clicks per queue session

Failure:

- Emit manual intervention `queue_presence_confirm`.
- Alert once per failure appearance.
- Preserve page.
- Do not reload.

## Forensics

Add capture labels:

- `page-classifier-signature-match`
- `queue-page-classified`
- `gatekeeper-captcha-appears`
- `manual-intervention-unknown-page`
- `queue-presence-confirm-before-click`
- `queue-presence-confirm-after-click`
- `acquisition-target-click-before`
- `acquisition-target-click-after`
- `acquisition-reload`

Add event fields where possible:

- `signatureId`
- `url`
- `botId`
- `selector`
- `pageKind`
- `manualReason`
- `cadence`
- `saleStart`

## Tests

Add first:

- `classifyPage()` returns `queue` for `https://wait.thaiticketmajor.com/view?...`.
- `classifyPage()` returns `queue` for `https://gatekeeper.thaiticketmajor.com/inflow/v2/?qid=...`.
- `classifyPage(url, html)` recognizes Queue-it markers when URL is otherwise unknown.
- `classifyManualIntervention()` returns `captcha` for Gatekeeper `stacks/sep`.
- Gatekeeper CAPTCHA HTML with draggable pieces stays manual; no click/drag/submit path exists.
- Queue-it presence modal is not CAPTCHA or unknown page.

Update current tests:

- Config tests: `queue_start` no longer required for `arm`.
- Queue schedule tests: replace `watcherDeadline()` with cadence tests.
- Main command behavior: `arm all` sends `arm` immediately; no queue-start timer.
- Worker behavior: `arm` starts acquisition after target validation.
- Acquisition has no `sale_start + 10min` deadline.
- Acquisition uses 500 ms DOM polling.
- Acquisition retries target only when still on event page.
- `holdQueue()` has no timeout throw for queue-like pages.
- `holdQueue()` exits on booking, manual page, stop, or fatal browser/page error.
- Visitor-presence auto-click success path.
- Visitor-presence rate limit.
- Visitor-presence click failure emits `queue_presence_confirm`.

Remove or rewrite:

- test expecting `watcherDeadline(sale_start)`.
- test expecting `holdQueue()` queue timeout throw.
- tests expecting `queue_start` to gate `arm`.

## Rollout Order

1. Add page signatures and classifier/manual-intervention tests.
2. Implement signatures in classifier and manual detector.
3. Replace queue scheduler with cadence helper; remove deadline behavior.
4. Replace `watchTargetUntilQueueOrBooking()` with acquisition loop.
5. Change `arm` to immediate acquisition; remove main-level queue-start scheduling.
6. Change `holdQueue()` to stop-driven passive wait.
7. Add visitor-presence auto-click.
8. Update configs, README, TUI command hint.
9. Run full test suite and inspect forensic output on dry run.

## Success Criteria

- `arm all` starts acquisition immediately.
- No `queue_start` required for queue acquisition.
- Bot continues after `sale_start`; no sale-start deadline.
- Event page reloads at controlled cadence until queue, booking, manual, stop, or fatal error.
- Queue-it wait and Gatekeeper inflow never become `unknown_page`.
- Gatekeeper CAPTCHA becomes manual `captcha` and is never acted on.
- Queue hold never times out while still queue-like.
- Queue-it visitor-presence prompt auto-clicks only under strict guards.
- Failed presence click alerts `queue_presence_confirm` and preserves page.
- Forensic events explain classification, target click, queue entry, CAPTCHA, and presence-confirm decisions.
