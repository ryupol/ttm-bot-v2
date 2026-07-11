# TTM Bot v2

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

TypeScript + Playwright assistant for running multiple Thai Ticket Major browser sessions from one terminal UI. It watches event and queue pages, targets one exact round, tries preferred zones, selects seats, and alerts when human action is needed.

TTM Bot v2 brings ideas from the original [TTM Bot](https://github.com/ryupol/ttm-bot) into one Ink TUI with isolated workers and persistent browser profiles.

> Use this project responsibly. Follow Thai Ticket Major terms, ticket limits, venue rules, and applicable law. Website behavior can change without notice. Never rely on automation alone for time-sensitive purchases.

## What It Does

- Runs multiple Playwright workers from one terminal.
- Keeps each browser session in `bot_data/worker_N`.
- Checks login state and prefills configured credentials for manual submission.
- Watches event page until exact configured round becomes available.
- Holds queue position without unsafe queue-page refreshes.
- Detects verification and CAPTCHA pages for manual completion.
- Tries configured zones in priority order.
- Selects contiguous seats using ticket count and row preferences.
- Sends optional Telegram alerts.
- Saves screenshots, HTML, console errors, and network failures in forensic mode.

Human remains responsible for login submission, CAPTCHA or anti-bot challenges, unexpected pages, purchase review, and payment.

## Requirements

- Current Node.js LTS release
- npm
- Google Chrome, or Playwright Chromium
- Thai Ticket Major account

## Quick Start

1. Install dependencies and browser:

```bash
npm install
npx playwright install chromium
```

2. Create local secrets:

```bash
cp secrets/.env.example secrets/.env
```

3. Edit `secrets/.env`:

```dotenv
ACCOUNT_EMAIL=your-email@example.com
ACCOUNT_PASS=your-password
ACCOUNT_CITIZEN_ID=1234567890123

TELEGRAM_TOKEN=
TELEGRAM_CHAT_ID=
```

4. Create concert config:

```bash
cp config/concerts/_template.yaml config/concerts/my-concert.yaml
```

5. Edit only concert-specific values:

```yaml
event_url: https://www.thaiticketmajor.com/performance/example.html

target_round:
  date: "2027-12-15"
  time: "18:00"

sale_start: "2027-10-01T10:00:00+07:00"
zone_priority: ["A1", "A2", "B1"]
ticket_count: 2
```

6. Start bots:

```bash
npm run start -- --bots 5 --concert config/concerts/my-concert.yaml
```

Full field reference: [docs/config.md](docs/config.md).

## Creating Another Concert

Copy template instead of copying old advanced config:

```bash
cp config/concerts/_template.yaml config/concerts/concert-name.yaml
```

Edit these values:

| Field | What to enter |
| --- | --- |
| `event_url` | Full Thai Ticket Major event or performance URL. |
| `target_round.date` | Desired show date in `YYYY-MM-DD`. |
| `target_round.time` | Time printed on desired round in `HH:mm`. |
| `sale_start` | Sale opening timestamp with Thailand offset, such as `2027-10-01T10:00:00+07:00`. |
| `zone_priority` | TTM zone codes in preferred order. |
| `ticket_count` | Number of contiguous seats to select. |

Physical concerts need no `target_round.type`; default is `offline`. Add type only for another product:

```yaml
target_round:
  date: "2027-12-15"
  time: "18:00"
  type: live_streaming # offline, live_streaming, rerun, or any
```

Avoid `any` when multiple products share same date and time.

## Accounts and Browser Sessions

`config/accounts.yaml` maps account fields to variable names in `secrets/.env`:

```yaml
reuse_first_account: true
accounts:
  - id: 1
    email_env: ACCOUNT_EMAIL
    pass_env: ACCOUNT_PASS
    citizen_id_env: ACCOUNT_CITIZEN_ID
```

With `reuse_first_account: true`, `--bots 5` uses same account credentials across five separate persistent browser profiles. Set it to `false` and add one entry per bot when each worker needs a different account.

Secrets stay outside YAML and are ignored by git. Never commit `secrets/.env` or `bot_data/`.

## Start Commands

Use default `config/concert.yaml`:

```bash
npm run start -- --bots 5
```

Use named concert:

```bash
npm run start -- --bots 5 --concert config/concerts/rookie-divos.yaml
```

Override every config path:

```bash
npm run start -- --bots 5 \
  --concert config/concerts/my-concert.yaml \
  --settings config/settings.yaml \
  --accounts config/accounts.yaml
```

Default browser uses installed Google Chrome through `browser.channel: chrome`. Remove `channel` from `config/settings.yaml` to use Playwright Chromium.

## Recommended Sale-Day Flow

1. Start bots before sale opens.
2. Complete login manually in each browser when requested.
3. Run `check all`. Logged-in sessions should show `READY Logged in`.
4. Run `go all` to watch configured event and round.
5. Leave queue pages untouched while bots show `IN_QUEUE`.
6. Complete CAPTCHA or verification steps when bot shows `MANUAL_INTERVENTION`.
7. Run `go N` if one bot does not resume after manual work.
8. Review selected tickets and complete payment manually.

Wrong or missing target round stops with error instead of clicking fallback round.

## TUI Commands

Targets accept `all` or bot number, such as `login all`, `go 4`, or `stop 4`.

| Command | Purpose |
| --- | --- |
| `login all` / `login N` | Check login state, prefill credentials, wait for manual submit. |
| `check all` / `check N` | Classify current page after manual browser changes. |
| `go all` / `go N` | Start or resume queue and booking flow. |
| `zone all SC SD SE` | Change runtime zone priority for every bot. |
| `zone N SC SD SE` | Change runtime zone priority for one bot. |
| `stop N` | Stop one bot while leaving browser open. |
| `reset N` | Navigate one bot to base site and return it to `IDLE`. |
| `log N` | Show logs from one bot. |
| `log all` | Return to combined logs. |

Runtime `zone` changes do not edit YAML. Restart reloads zone order from concert file.

## How Flow Works

```text
event page
  -> exact target round
  -> queue / verification
  -> zones
  -> seat selection
  -> payment or enrollment page
```

Each worker classifies current page after navigation and routes it to dedicated queue, verification, booking, or manual-intervention service. Payment and enrollment pages mark worker `DONE`; payment remains human-controlled.

Architecture guide: [docs/structure.md](docs/structure.md).

## Troubleshooting

| Symptom | Action |
| --- | --- |
| `Missing env vars referenced by config` | Check variable names in `config/accounts.yaml` and values in `secrets/.env`. |
| `Target round not found` | Verify date, time, type, and event URL against TTM page. |
| Browser does not open | Install Chromium or verify configured Chrome channel exists. |
| Bot waits on zone page | Add zone codes to `zone_priority` or use `zone N ...`. |
| Manual page does not resume | Complete page in browser, then run `check N` and `go N`. |
| Need evidence after failure | Enable forensic observability and inspect `bot_data/runs/<run-id>/`. |

Never refresh queue page unless intentionally taking over manually.

## Project Layout

```text
config/                 settings, accounts, and concert YAML
src/config/             Zod schemas and YAML/env loading
src/ipc/                main-thread/worker commands and events
src/tui/                Ink terminal UI
src/bot/auth/           login and session handling
src/bot/queue/          event watching and queue handling
src/bot/verification/   verification-page handling
src/bot/booking/        round, zone, and seat selection
src/bot/observability/  Telegram alerts and forensic artifacts
tests/                  unit and workflow tests
```

## Development Checks

```bash
npm test
npm run typecheck
npm run build
```

## License

Released under [MIT License](LICENSE). Copyright (c) 2026 Ryu Polawat.
