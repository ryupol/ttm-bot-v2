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

`src/bot/` owns automation behavior.

Current useful subfolders:

```text
src/bot/pages/        page-specific Playwright actions/classification
```

Recommended next split:

```text
src/bot/worker.ts           worker-thread adapter only
src/bot/workflow.ts         readable command/page flow
src/bot/services/           stateful automation modules
src/bot/models/             bot-domain data types
src/bot/repositories/       persistence/file I/O adapters
src/bot/utils/              reusable pure helpers only
```

## Services

Use service modules for stateful behavior or domain operations with meaningful depth.

Good candidates:

- `BrowserSession`: Playwright context/page lifecycle.
- `LoginService`: login detection and form fill.
- `QueueAcquisitionService`: event-page watch, target round click, queue handoff.
- `QueueHoldingService`: queue presence hold, queue manual alert, queue exit resume.
- `BookingService`: zone selection, fixed-page seat selection, done states.
- `ManualInterventionService`: manual-page detection, dedupe, alerts.
- `VerificationService`: citizen ID and terms verification.
- `ForensicReporter`: capture/event calls around decisions.

Avoid a giant service that owns all bot behavior.

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

Use `models/` for data shapes shared across bot modules.

Good candidates:

- `ManualIntervention`: manual intervention reason/state/transition.
- `TargetRound`: resolved target round data from event page.
- `Verification`: submit results for citizen ID and terms pages.

Keep IPC-only message contracts in `src/ipc/types.ts` unless bot-domain types start leaking into multiple bot services.

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

- `zonePriority.ts`
- `queueSchedule.ts`
- `seatPicker.ts`
- `pageFlow.ts`

## Refactor Direction

Preferred direction for `worker.ts`:

1. Make `worker.ts` a thin worker-thread adapter.
2. Move command/page orchestration into `bot/workflow.ts`.
3. Extract browser lifecycle into `services/BrowserSession.ts`.
4. Extract queue and booking flows into focused services.
5. Move only repeated pure helpers into named `utils/` files.

Target read shape:

```ts
const runtime = createBotWorkerRuntime(workerData, parentPort);
void runtime.start();
```

Workflow should read as sequence, not as implementation dump.
