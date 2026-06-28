# TTM Queue Page Intelligence Design

## Context

The 2026-06-27 run showed that queue-ready mode reached real ThaiTicketMajor queue and gatekeeper pages, but classified several of them as `unknown`.

Observed pages:

- Queue-it wait page: `https://wait.thaiticketmajor.com/view?...`
- Gatekeeper inflow: `https://gatekeeper.thaiticketmajor.com/inflow/v2/?qid=...`
- Gatekeeper CAPTCHA: `https://gatekeeper.thaiticketmajor.com/stacks/sep/?ks=...`
- Queue-it visitor presence modal with `#buttonConfirmVisitorPresence` and text `Still here?`

Current classifier only treats URLs containing `/queue` as queue pages. This causes valid Queue-it pages to become `unknown_page`, which pauses the bot at the wrong time.

## Goals

- Classify real Queue-it and Gatekeeper queue pages as queue-related pages.
- Detect Gatekeeper CAPTCHA as manual intervention.
- Auto-click Queue-it visitor-presence confirmation when it appears.
- Keep CAPTCHA, terms, and verification pages manual.
- Turn new run artifacts into stable classifier fixtures and tests.
- Preserve forensic evidence at every decision point.

## Non-Goals

- CAPTCHA solving.
- Queue bypass.
- Proxy, identity, or browser fingerprint spoofing.
- Automatic terms acceptance.
- Automatic payment or verification.
- High-frequency queue polling or reload loops.

## Page Intelligence Model

Add a page-signature layer used by both page classification and manual intervention detection.

Each signature defines:

- `id`: stable internal name.
- `kind`: classified page kind or manual-intervention reason.
- `url`: optional URL regular expression.
- `html`: optional required HTML markers.
- `host`: optional exact host guard.
- `action`: optional safe automated action.

Initial signatures:

```ts
[
  {
    id: "queueit_wait",
    kind: "queue",
    url: /wait\.thaiticketmajor\.com\/view/i,
    html: ["queueViewModel", "ticketmasterasia"],
  },
  {
    id: "gatekeeper_inflow",
    kind: "queue",
    url: /gatekeeper\.thaiticketmajor\.com\/inflow\/v2/i,
  },
  {
    id: "gatekeeper_captcha",
    kind: "captcha",
    url: /gatekeeper\.thaiticketmajor\.com\/stacks\/sep/i,
    html: ["CAPTCHA verification", "Verify You Are Human"],
  },
  {
    id: "queue_presence_confirm",
    kind: "queue_presence_confirm",
    host: "wait.thaiticketmajor.com",
    html: ["buttonConfirmVisitorPresence", "Still here?"],
    action: "auto_click",
  },
]
```

`classifyPage(url, html?)` should keep URL-only classification for existing callers. When HTML is available, it should also apply HTML-marker signatures.

## Queue Classification

Queue pages include:

- URL host `wait.thaiticketmajor.com` with path `/view`.
- URL host `gatekeeper.thaiticketmajor.com` with path `/inflow/v2`.
- HTML containing Queue-it markers:
  - `window.queueViewModel`
  - `QueueIt.Queue.InQueueView`
  - `data-pageid="before"`
  - `pageClass: before prequeue`
  - `ticketmasterasia`

Queue pages must not trigger `unknown_page`.

`holdQueue()` should not rely only on `concert.queue_indicators.queue_url_pattern`. It should ask the classifier whether the current page is queue-like. The configured pattern can remain as a backwards-compatible extra match.

## Visitor Presence Auto-Click

Queue-it visitor-presence confirmation is safe to automate only under strict guards:

- Current host must be `wait.thaiticketmajor.com`.
- Current page must classify as queue.
- `#buttonConfirmVisitorPresence` must be visible and enabled.
- Button text or surrounding modal must include the known presence markers:
  - `Still here?`
  - `Please confirm you're still waiting`
  - `Yes, I'm here`

Behavior:

1. Detect modal during `holdQueue()`.
2. Capture forensic artifact before click.
3. Click `#buttonConfirmVisitorPresence`.
4. Wait briefly for either:
   - button text `Thanks`
   - modal hidden
   - button disabled
5. Emit log and forensic event:
   - `queue-presence-confirm detected`
   - `queue-presence-confirm clicked`
6. Continue holding queue.

Rate limits:

- Minimum interval: 30 seconds between auto-clicks per bot.
- Maximum clicks: 20 per queue session.

Failure handling:

- If detection succeeds but click fails, emit manual intervention reason `queue_presence_confirm`.
- Do not spam alerts for repeated failures.
- Continue preserving the queue page; do not reload because of this modal.

## CAPTCHA Handling

Gatekeeper CAPTCHA markers:

- URL: `gatekeeper.thaiticketmajor.com/stacks/sep`
- `main[aria-label="CAPTCHA verification"]`
- Heading: `Verify You Are Human`
- Thai text: `กรุณาเรียงภาพให้ถูกต้อง`
- Draggable image pieces: `[draggable="true"]`
- Submit button text: `ยืนยัน / Verify`

Behavior:

- Classify as `captcha`.
- Emit manual intervention alert.
- Capture screenshot and HTML.
- Do not click, drag, drop, submit, or solve.
- After user solves, resume existing queue/booking flow from the current page.

## Manual Intervention Reasons

Extend manual reasons:

```ts
type ManualInterventionReason =
  | "captcha"
  | "verify"
  | "terms"
  | "unknown_page"
  | "queue_presence_confirm";
```

`queue_presence_confirm` is only used when safe auto-click failed or is disabled. Normal detection should auto-click instead of alerting.

## Forensics

Add forensic labels:

- `queue-presence-confirm-before-click`
- `queue-presence-confirm-after-click`
- `gatekeeper-captcha-appears`
- `queue-page-classified`

Add forensic events:

- `queue-presence-confirm detected`
- `queue-presence-confirm clicked`
- `manual-intervention gatekeeper-captcha`
- `page-classifier signature-match`

Events should include:

- `signatureId`
- `url`
- `botId`
- relevant selector when present

## Tests

Add or update tests:

- `classifyPage()` returns `queue` for `wait.thaiticketmajor.com/view`.
- `classifyPage()` returns `queue` for `gatekeeper.thaiticketmajor.com/inflow/v2`.
- HTML-marker classification recognizes Queue-it prequeue.
- `classifyManualIntervention()` returns `captcha` for Gatekeeper `stacks/sep` CAPTCHA HTML.
- Queue-it visitor-presence modal is not treated as CAPTCHA or unknown page.
- `holdQueue()` auto-clicks `#buttonConfirmVisitorPresence` when visible and enabled.
- `holdQueue()` rate-limits visitor-presence clicks.
- `holdQueue()` emits manual intervention `queue_presence_confirm` if auto-click fails.
- Existing queue exit and CAPTCHA tests still pass.

Use small HTML fixtures from the 2026-06-27 run where possible, trimmed to stable markers rather than full captured pages.

## Rollout

1. Add page signatures and tests.
2. Teach classifier and manual-intervention detection to use signatures.
3. Update `holdQueue()` to use classifier plus configured queue pattern.
4. Add visitor-presence auto-click with strict host and rate guards.
5. Add runbook note to README:
   - Queue-it presence confirm is auto-clicked.
   - CAPTCHA remains manual.
   - Unknown pages still pause and capture artifacts.

## Success Criteria

- Queue-it wait pages no longer become `unknown_page`.
- Gatekeeper inflow pages no longer become `unknown_page`.
- Gatekeeper CAPTCHA alerts as CAPTCHA and remains manual.
- Queue-it visitor-presence modal is clicked automatically under guarded conditions.
- Logs and forensic artifacts explain every classifier decision.
- Tests cover each observed real-world page pattern.
