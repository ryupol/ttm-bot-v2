# TTM Queue-Ready Mode Design

## Context

ThaiTicketMajor event page for Pond Phuwin Space & Soul Odyssey says online queue appears from 09:00 and ticket sale starts at 10:00 Bangkok time on 2026-06-28.

Source: https://www.thaiticketmajor.com/concert/pond-phuwin-space-soul-dyssey-concert.html

Current page source shows target round buttons as disabled before sale, for example:

```html
<a data-button="9253" href="javascript:;" class="btn" disabled>
  <span class="item-show">18:00</span>
</a>
```

The page contains separate product blocks for offline venue, Live Streaming, and RERUN. Same performance dates appear in multiple blocks, so `event_date` alone is not enough to choose the correct round.

This design stays within these constraints:

- One real account per real person/session.
- No CAPTCHA bypass.
- No queue bypass.
- No proxy or identity spoofing.
- Automation covers timing, navigation, alerts, and seat selection after legitimate page access.

## Goals

- Prepare five browser sessions before queue opens.
- Enter legitimate queue as soon as queue UI becomes available.
- Select the exact offline target round, not streaming or rerun products.
- Avoid wrong-ticket fallback.
- Pause on CAPTCHA or unknown manual pages.
- Preserve enough screenshots/logs to improve next run.

## Non-Goals

- Solving CAPTCHA automatically.
- Circumventing anti-bot systems.
- Bypassing queue order.
- High-frequency refresh loops.
- Rewriting the full bot orchestrator.

## Config

Add explicit target and timeline fields to `config/concert.yaml`:

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
  mode: forensic # forensic | minimal
  artifact_root: bot_data/runs
  capture_html: true
  capture_screenshot: true
  capture_network_failures: true
  capture_console_errors: true
  keep_runs: 10
```

`event_date` remains a deprecated fallback for older configs. New queue-ready behavior should use `target_round`. If exact target is missing, the bot aborts instead of falling back to another button.

## Target Round Resolver

Create a resolver for the event page DOM. It scans `.event-detail-item` blocks and classifies each block:

- `offline`: venue/title text does not contain Live Streaming or RERUN.
- `live_streaming`: venue/title text contains Live Streaming or TTM LIVE.
- `rerun`: venue/title text contains RERUN, or row text starts with `(Rerun)`.
- `any`: first matching date/time, only when configured explicitly.

For each candidate row, it matches:

- row date against `target_round.date`
- `.item-show` text against `target_round.time`
- product type against `target_round.type`

Resolver returns structured state:

```ts
type TargetRoundState = {
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
```

`queueOrBookingCapable` is true when the button is enabled and has evidence of queue or booking navigation, such as queue text, queue URL, or `booking...zones.php` in `href`/`onclick`.

## Queue-Ready Flow

### Prepare

`prepare all`:

1. Load event page.
2. Verify login/session best effort.
3. Resolve exact target round.
4. Accept disabled target before queue/sale as valid readiness.
5. Show state like `READY target=offline 2026-08-21 18:00 disabled`.

### Arm

`arm all`:

1. Run preflight.
2. Schedule `queue_start`.
3. Schedule `sale_start`.
4. Abort all scheduling if any required preflight check fails.

### Queue Start

At `queue_start`:

1. Reload event page once.
2. Resolve exact target.
3. If target is queue/booking-capable, click it.
4. If URL enters queue, stop reloading and hold queue.
5. If target remains disabled, enter watcher mode.

### Watcher Mode

Watcher mode handles uncertainty around whether TTM enables queue at 09:00 or sale at 10:00.

Network reload schedule per bot:

```text
0s, 1s, 3s, 5s, 10s, then every 10s
```

Each bot applies a small per-bot offset so five sessions do not reload at the same millisecond:

```text
bot offset = botId * 150ms
```

Between reloads, the bot only reads current DOM state every 250-500ms. DOM checks do not make network requests.

Watcher stops when one of these happens:

- queue entered
- booking/zones/fixed page reached
- manual intervention appears
- target missing or mismatched, causing abort
- timeout reaches `sale_start + 10min`

After manual intervention clears, watcher resumes only if page is still the event page and target remains valid.

## Queue Hold

When URL matches queue pattern:

- Stop event-page reloads.
- Preserve queue page.
- Monitor page state.
- Alert on manual intervention.
- Continue when URL leaves queue.
- Use queue timeout long enough for queue window, not current 300 seconds.

## Manual Intervention State

Replace single `captchaAlerted` boolean with a state machine:

```text
visible false -> true  = alert once, state MANUAL_INTERVENTION
visible true -> true   = no repeat alert
visible true -> false  = log cleared, resume previous flow
```

Reasons:

- `captcha`
- `verify`
- `terms`
- `unknown_page`

Detection layers:

1. Known CAPTCHA/challenge selectors:
   - `img.yz`
   - `form[action*="_captcha"]`
   - `iframe[src*="google.com/recaptcha"]`
   - `iframe[src*="challenges.cloudflare.com"]`
   - `input[name="cf-turnstile-response"]`
   - `.cf-turnstile`
   - `.geetest`
   - `.puzzle-slider`

2. Known manual URLs/pages:
   - `verify.php`
   - `verify_condition.php`
   - URL containing `captcha`
   - visible policy/condition confirmation controls

3. Unknown-page guard:
   - If bot leaves expected event/queue/booking paths and cannot classify page, pause.
   - Alert user with bot id.
   - Save screenshot and HTML.
   - Do not continue automation until user acts or page becomes known.

During manual intervention, the bot does not click, reload watcher pages, or select seats.

## Observability and Forensic Mode

For competitive events, use `observability.mode: forensic`. Forensic mode captures decision-point evidence without recording every watcher poll or every 250-500ms DOM check.

Artifacts are grouped by run:

```text
bot_data/runs/2026-06-28T085900+0700/
  run.json
  events.jsonl
  bot-1/
    console.jsonl
    network.jsonl
    001-preflight-target.png
    001-preflight-target.html
    002-before-target-click.png
    002-before-target-click.html
    003-after-target-click.png
    003-after-target-click.html
  bot-2/
    ...
```

`run.json` records immutable run configuration:

- run id
- start time
- bot count
- target round
- queue start
- sale start
- observability mode
- config file paths

`events.jsonl` records every meaningful state/action:

```json
{"ts":"2026-06-28T08:59:59.900+07:00","elapsedMs":1234,"botId":1,"state":"WATCHING_QUEUE_OPEN","url":"https://www.thaiticketmajor.com/...","pageKind":"event","action":"target_resolved","targetRound":{"dataButton":"9253","type":"offline","disabled":true},"result":"ok"}
```

Each event includes:

- timestamp ISO
- monotonic elapsed milliseconds
- bot id
- state
- page URL
- page kind
- target round state when available
- action name
- selector clicked when applicable
- result
- error message and stack when applicable

Capture screenshot and HTML only at decision points:

- preflight target resolved
- before target click
- after target click/navigation
- queue entered
- manual intervention appears
- manual intervention clears
- unknown page
- booking/zones/fixed loaded
- before seat selection
- after seat selection
- no seats / sold out / error page
- payment / done
- uncaught error / timeout

Attach Playwright listeners per page:

- `requestfailed` -> `network.jsonl`
- navigation response with status `>= 400` -> `network.jsonl`
- `pageerror` -> `console.jsonl`
- console warning/error -> `console.jsonl`

Do not write full HAR by default. HAR is too heavy for the critical path and should be a separate debug option.

Redact secrets and personal data before writing artifacts:

- account email
- password
- citizen id
- Telegram token/chat id
- cookies and authorization headers
- payment form fields

Key rule: capture before action, not only after failure. If target sells out fast, the final failure page is not enough. Evidence must answer:

- Was the correct offline round selected?
- Was the button disabled or enabled?
- Did click happen?
- Did queue open?
- Did bot navigate to the wrong URL?
- Did sold out happen before or after seat page?

## Preflight

`arm all` must verify:

- config parses `target_round`, `queue_start`, and `sale_start`
- `queue_start < sale_start`
- five workers are running
- each browser can load event page
- each worker resolves exact target round
- target type/date/time match config
- Telegram test succeeds if enabled
- clock drift check passes or produces hard blocking warning
- window tiling completed or reports explicit warning
- screenshot/HTML of target round is saved before queue
- run artifact folder is created when forensic mode is enabled

Any required failure aborts `arm all`; no partial schedule.

## TUI and Alerts

Bot states should distinguish:

- `READY`
- `ARMED`
- `WATCHING_QUEUE_OPEN`
- `IN_QUEUE`
- `MANUAL_INTERVENTION`
- `BOOKING`
- `DONE`
- `ERROR`

Telegram alerts include:

- bot id
- state/reason
- target round
- current URL

## Testing

Tests should use saved HTML fixtures, not live TTM requests.

Coverage:

- config accepts `target_round`, `queue_start`, `sale_start`
- resolver picks offline `9253`, not live streaming `9254`, not rerun `9255`
- missing exact target aborts
- disabled target is valid during prepare
- watcher schedule is `0,1,3,5,10,20...`
- per-bot offset is applied
- manual intervention alerts once per visible appearance
- manual intervention clears and can alert again on later reappearance
- queue watcher timeout is `sale_start + 10min`
- `arm all` command parses and dispatches
- forensic run folder naming is stable
- events are written as JSONL
- screenshots/HTML are captured only at decision points
- network and console listeners write expected JSONL entries

## Implementation Order

1. Extend config schema and example config.
2. Add target round resolver with fixture tests.
3. Add manual intervention detector and state-machine tests.
4. Add forensic run logger and artifact writer.
5. Add queue watcher schedule helper and tests.
6. Add `arm all` command and preflight.
7. Integrate queue-start watcher into worker flow.
8. Update TUI states and Telegram alert messages.
