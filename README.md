# TTM Bot v2

TypeScript + Playwright bot for running multiple Thai Ticket Major browser sessions from one Ink TUI.

## Quick Start

```bash
npm install
npx playwright install chromium
npm run start -- --bots 5
```

Default browser is installed Google Chrome via `browser.channel: chrome`. Remove `channel` from `config/settings.yaml` to use bundled Playwright Chromium.

Browsers use persistent profiles under `bot_data/worker_N`. Startup auto-login is enabled by default: each bot checks the event page, skips if already logged in or done, otherwise opens the login page and prefills credentials for manual submit.

## Config Files

The app reads three YAML files and one local secrets file:

| File | Purpose |
| --- | --- |
| `config/settings.yaml` | App/runtime settings: browser, windows, Telegram, base URL. |
| `config/accounts.yaml` | Account routing and env-var names for credentials. |
| `config/concert.yaml` or `config/concerts/*.yaml` | Event target, queue timing, zone priority, seat strategy. |
| `secrets/.env` | Local secret values. Ignored by git. |

Copy `secrets/.env.example` to `secrets/.env`, then fill credentials and optional Telegram values.

Full setup guide: [docs/config.md](docs/config.md).

## Start Commands

Default config:

```bash
npm run start -- --bots 5
```

Specific concert:

```bash
npm run start -- --bots 5 --concert config/concerts/rookie-divos.yaml
```

Override every config path:

```bash
npm run start -- --bots 5 --concert config/concert.yaml --settings config/settings.yaml --accounts config/accounts.yaml
```

## TUI Commands

Targets are `all` or one bot number, for example `login all`, `go 4`, or `stop 4`.

| Command | When to Use | What It Does |
| --- | --- | --- |
| `login all` / `login N` | Manual retry when startup login was disabled, interrupted, or bot shows `Login required`. | Checks login state, fills username/password if needed, and waits for manual submit. Skips payment/enroll pages. |
| `check all` | Diagnostic command after manual browser changes. | Reads current URL/HTML, classifies each bot page, and updates TUI state without clicking or navigating. |
| `go N` / `go all` | Main start/resume command. | Starts queue acquisition from event/home, holds queue pages, resumes zones/fixed pages, and marks payment/enroll pages done. |
| `zone N SC SD SE` / `zone all SC SD SE` | Change zone priority during the current run. | Updates runtime zone priority only; does not edit YAML. Bots on `zones.php` use the new priority immediately. Bots already on `fixed.php` finish one fast scan, then use the new priority for the next zone. |
| `stop N` | Stop one bot or cancel bad run. | Stops bot `N`. Browser remains open. |
| `reset N` | Return bot to base site/manual login state. | Navigates to `base_url` and marks bot `IDLE`. |
| `log N` | Focus logs for one bot. | Filters TUI log panel to bot `N`. |
| `log all` | Return to combined logs. | Shows all bot logs. |

## Sale-Day Flow

1. Start sessions:

```bash
npm run start -- --bots 5
```

2. Submit login manually in browser windows when needed.

3. Check state:

```text
check all
```

Expected after login: `READY Logged in`.

4. Start or resume:

```text
go all
```

Expected initial state: `WATCHING_QUEUE_OPEN`.

5. If queue opens, bot enters `IN_QUEUE`. Do not refresh queue pages unless taking over manually.

6. If manual step appears, bot enters `MANUAL_INTERVENTION`. Solve in browser, then use `go N` if bot does not continue automatically.

7. On seat page, bot enters `BOOKING` and selects seats using configured zone priority and seat strategy.

8. If preferred zones change during booking, use `zone all SC SD SE` or `zone N SC SD SE`. This affects the current run only. Restart reloads zone priority from YAML.

## Emergency Notes

- Wrong or missing target round: bot errors instead of clicking fallback button.
- Need immediate start: run `go all`.
- Need pause one bot: run `stop N`.
- Need resume after manual browser work: run `go N`.
- Need inspect evidence: check `bot_data/runs/<run-id>/events.jsonl` and per-bot screenshots/HTML.
- Done pages: `paymentall.php` and `enroll.php` both mark bot `DONE` and are skipped by `login all` / `go all`.

## Project Structure

Design guide: [docs/structure.md](docs/structure.md).

Current folder intent:

- `src/main.ts`: composition root. Loads config, starts workers, renders TUI.
- `src/config/`: config schema, YAML/env loading, account selection.
- `src/ipc/`: main-thread to worker message types, channels, commands.
- `src/tui/`: Ink UI components only.
- `src/bot/`: browser automation, page flows, queue/booking logic.

## Checks

```bash
npm run typecheck
npm test
```
