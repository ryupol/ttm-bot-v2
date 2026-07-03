# Project Structure

Use this guide when adding or moving code.

The intended shape follows same idea as the shopping-pipeline `spidermonkey` module: entrypoint wires dependencies, workflow tells the story, services do domain work, repositories touch storage, models name data.

## Folder Intent

```text
src/
  main.ts
  config/
  ipc/
  tui/
  bot/
```

## Root

`src/main.ts` is the composition root.

It should:

- parse CLI args
- load config
- select accounts
- create worker handles
- render TUI
- route user commands to workers

It should not contain Playwright page logic or seat/queue decisions.

## Config

`src/config/` owns config parsing and validation.

Keep here:

- Zod schemas
- YAML loading
- env-var resolution
- account selection from config

Do not put browser automation or worker logic here.

## IPC

`src/ipc/` owns main-thread to worker contracts.

Keep here:

- message types
- worker channel wrapper
- command parsing and target resolution
- startup event-to-command orchestration

Do not put Playwright selectors or booking rules here.

## TUI

`src/tui/` owns Ink rendering and user input UI.

Keep here:

- layout components
- command input
- log panels
- bot state display

Do not put config loading, worker-thread setup, or browser automation here.

## Bot

`src/bot/` owns automation behavior. Code is grouped by bot domain, not by generic layer buckets.

Current folders:

```text
src/bot/auth/             login markers, login flow, access-block tracking
src/bot/booking/          zone selection, fixed-page seat selection, round resolution
src/bot/browser/          Playwright context/page lifecycle and window tiling
src/bot/manual/           CAPTCHA/login/terms/manual-step detection and recovery
src/bot/observability/    Telegram notifications, seat alerts, forensic artifacts
src/bot/queue/            queue acquisition, queue hold, presence confirmation
src/bot/routing/          page classification, page flow policy, current-page router
src/bot/runtime/          worker-thread adapter and runtime orchestration
src/bot/verification/     citizen ID and terms verification pages
```

Keep new bot files in one of these folders unless a new domain is clearly needed.

## Domain Boundaries

Prefer domain-owned modules:

- `auth/`: login state, login page interaction, HTTP access block responses.
- `booking/`: event round choice, zone movement, seat selection, booking completion.
- `browser/`: browser lifecycle, profile directory, Playwright window layout.
- `manual/`: manual intervention classification, alert dedupe, wait/resume behavior.
- `observability/`: notifications and forensic artifact write/capture logic.
- `queue/`: queue entry watch, queue wait-page behavior, queue presence confirmation.
- `routing/`: URL/HTML page kind classification and dispatch to domain services.
- `runtime/`: composition of domain services and worker command handling.
- `verification/`: `verify.php` and `verify_condition.php` actions.

Avoid generic `services/`, `pages/`, or root-level `bot/*.ts` helpers. They hide ownership and inflate imports.

## Repositories

Use repositories only for persistence or external storage.

Good candidate:

- forensic artifact writer.

Bad candidate:

- page classifier
- seat picker
- queue scheduler

Those are domain logic, not repositories.

## Models

Do not create `models/` for small status/result types with clear ownership. Co-locate those with the module that creates or owns the concept:

- manual intervention state in `manual/ManualIntervention.ts`
- target round state in `booking/TargetRoundResolver.ts`
- verification submit results in `verification/VerifyPage.ts`

Create `models/` only when a data shape is truly cross-domain and has no clearer owner. Keep IPC-only message contracts in `src/ipc/types.ts`.

## Utils

Use `utils/` sparingly.

Allowed:

- pure helper
- reused by at least two modules
- narrow file name such as `url.ts`, `time.ts`, `css.ts`, `errors.ts`

Avoid:

- `utils/helpers.ts`
- I/O in utils
- one-call-site helper moved too early
- domain logic with unclear owner

If helper belongs to one domain, prefer domain file name:

- `booking/ZoneSelector.ts`
- `queue/QueueReloadScheduler.ts`
- `booking/seatPicker.ts`
- `routing/PageFlowPolicy.ts`

## Refactor Direction

Preferred direction for runtime changes:

1. Keep `runtime/worker.ts` as thin worker-thread adapter.
2. Keep command/page orchestration in `runtime/BotRuntime.ts`.
3. Put stateful domain operations in their owning domain folder.
4. Move only repeated pure helpers into named domain files.

Target read shape:

```ts
const runtime = createBotRuntime(workerData, parentPort);
void runtime.start();
```

Workflow should read as sequence, not as implementation dump.
