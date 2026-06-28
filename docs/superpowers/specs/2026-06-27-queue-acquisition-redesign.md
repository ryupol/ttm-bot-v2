# TTM Queue Acquisition Redesign

## Context

ThaiTicketMajor sale-day flow uses Queue-it for scheduled waiting rooms. In that mode, entering the pre-queue before randomization matters more than clicking the button at the exact sale-start millisecond. Late entry after sale start is still valuable because reaching the queue late is better than never reaching the queue.

Current queue-ready logic still behaves like a click-speed race:

- `queue_start` schedules a timer.
- watcher stops around `sale_start + 10min`.
- queue holding has a timeout.
- classifier misses real Queue-it and Gatekeeper pages unless URL contains `/queue`.

This design changes the bot from a precision timer into a persistent queue acquisition state machine.

## Goals

- Remove `queue_start` from sale-day queue acquisition.
- Make `arm all` start queue acquisition immediately after target validation.
- Keep trying until queue, booking, manual intervention, user stop, or fatal browser error.
- Preserve Queue-it sessions by never reloading once Queue-it or Gatekeeper queue pages are reached.
- Use the queue page intelligence signatures from `2026-06-27-queue-page-intelligence-design.md`.
- Keep reload/click behavior controlled, not high-frequency.
- Keep CAPTCHA, verification, terms, and unknown pages manual.

## Non-Goals

- Queue bypass.
- CAPTCHA solving.
- Proxy, identity, or browser fingerprint spoofing.
- Automatic terms acceptance.
- Automatic payment or verification.
- High-frequency queue polling or reload loops.

## Flow

`prepare all` keeps its current role: load the event page, validate login/session readiness, and resolve the exact configured target round.

`arm all` starts acquisition immediately. It should no longer schedule a future `queue_start` timer.

`go all` remains a manual immediate start path and should use the same acquisition loop as `arm all`.

Acquisition loop behavior:

1. Navigate to the configured event page.
2. Classify the current page.
3. If page is queue-like, stop acquisition and enter queue hold.
4. If page is booking-like, continue booking.
5. If page is CAPTCHA, verify, terms, or unknown, alert manual intervention and preserve the page.
6. If still on the event page, resolve the exact configured target round.
7. If the target is queue-capable, click it once.
8. Wait 2-3 seconds for navigation, URL change, or page-kind change.
9. If still on the event page, resume DOM polling and scheduled reloads.

The loop has no sale-day give-up timeout. User `stop` is the normal termination path.

## Timing

Before `sale_start`:

- Reload event page every 10-15 seconds.
- Poll DOM and click eligibility every 500 ms.

After `sale_start`:

- Reload event page every 5-10 seconds.
- Poll DOM and click eligibility every 500 ms.

Use per-bot jitter or offset to avoid synchronized reload bursts.

`sale_start` only affects cadence and status labels. It must not end acquisition. A late queue is still useful.

## Classification

Classification should be URL-first, HTML-fallback:

1. Run URL-only classification first.
2. If URL result is conclusive, use it.
3. If URL result is `unknown` or otherwise insufficient, fetch lightweight HTML and apply page signatures.

Queue-like pages include signatures from `2026-06-27-queue-page-intelligence-design.md`:

- `wait.thaiticketmajor.com/view`
- `gatekeeper.thaiticketmajor.com/inflow/v2`
- Queue-it HTML markers such as `queueViewModel`, `QueueIt.Queue.InQueueView`, `data-pageid="before"`, `pageClass: before prequeue`, and `ticketmasterasia`

Manual pages include:

- Gatekeeper CAPTCHA at `gatekeeper.thaiticketmajor.com/stacks/sep`
- CAPTCHA HTML markers
- existing verify, terms, and unknown-page handling

## Queue Hold

Once the bot reaches Queue-it wait, Queue-it pre-queue, or Gatekeeper inflow:

- Do not reload.
- Do not re-click target.
- Monitor queue page.
- Continue until booking page, manual CAPTCHA/verify/terms, user `stop`, or fatal browser/page error.
- Do not use `manual_solve_timeout` as a queue wait timeout.

Queue-it visitor presence confirmation should be added after classifier and acquisition loop work. It should follow the strict guards from the queue intelligence spec:

- host is `wait.thaiticketmajor.com`
- page is classified as queue
- `#buttonConfirmVisitorPresence` is visible and enabled
- modal/button text contains known presence markers
- rate limit clicks per bot/session

If guarded auto-click fails, emit manual reason `queue_presence_confirm` and preserve the page.

## Module Changes

- `pageSignatures`: own TTM Queue-it and Gatekeeper signatures.
- `classifier`: expose URL-first classification with optional HTML fallback.
- `manualIntervention`: use signatures for Gatekeeper CAPTCHA and manual states.
- `worker` or a new `queueAcquisition` helper: own acquisition loop, cadence, click retry, and stop handling.
- `holdQueue`: own passive queue waiting and later visitor-presence confirmation.
- `main`: remove queue-start timers and pending queue-start state.
- `config`: remove `queue_start` from required sale-day config.

## Config And Commands

Remove `queue_start` from:

- schema validation
- concert YAML files
- `arm` validation
- timer scheduling
- README runbook
- forensic metadata, unless kept as ignored legacy metadata for old runs

Keep `sale_start` because it controls cadence and status:

- before sale: gentle acquisition
- after sale: late queue acquisition

Command behavior:

- `prepare all`: validate exact target round.
- `arm all`: validate target, then start acquisition immediately.
- `go all`: start acquisition immediately.
- `stop N/all`: stop acquisition or queue hold.
- `assign N`: continue after manual intervention from current page.

## Error Handling

- CAPTCHA, verify, terms: emit `MANUAL_INTERVENTION`, alert once, preserve page.
- Unknown page: capture screenshot and HTML, alert manual, preserve page.
- Queue presence confirmation click failure: emit `queue_presence_confirm`, preserve page, no reload.
- Single reload/click failure: log and continue acquisition unless browser/page is fatally closed.
- Fatal browser/page error: stop that bot and preserve available forensics.

## Tests

Add or update tests for:

- config no longer requires `queue_start`.
- `arm all` starts acquisition immediately and does not schedule a timer.
- acquisition has no `sale_start + 10min` deadline.
- pre-sale reload cadence is 10-15 seconds.
- post-sale reload cadence is 5-10 seconds.
- DOM poll/click interval is 500 ms.
- target click happens once, waits for navigation/change, then retries only if still on event page.
- URL classifier recognizes Queue-it wait and Gatekeeper inflow pages.
- HTML fallback catches Queue-it markers when URL alone is insufficient.
- Gatekeeper CAPTCHA becomes manual intervention.
- `holdQueue()` has no queue timeout for queue-like pages.
- `holdQueue()` exits on booking, manual pages, stop, or fatal browser/page error.
- visitor presence auto-click is covered in the later queue-intelligence implementation step with rate guards.

## Rollout

1. Implement queue page intelligence classifier.
2. Replace queue-start timer model with immediate acquisition on `arm`.
3. Remove acquisition deadline and sale-day give-up behavior.
4. Update queue hold to be manual-stop-only.
5. Add visitor-presence auto-click under strict guards.
6. Update README sale-day runbook.

## Success Criteria

- `arm all` starts queue acquisition immediately.
- Bot does not stop trying because sale start passed.
- Bot does not timeout while legitimately waiting in Queue-it.
- Real Queue-it and Gatekeeper queue pages are not classified as unknown.
- Once Queue-it is reached, bot preserves page/session and does not reload.
- Late queue acquisition after `sale_start` continues until user stop or progress to queue/booking/manual.
