# Config Guide

This project uses YAML for non-secret settings and `secrets/.env` for secret values.

## Files

```text
config/settings.yaml      app/runtime settings
config/accounts.yaml      account routing and env-var names
config/concert.yaml       default event target
config/concerts/*.yaml    named event configs
secrets/.env              local secret values, ignored by git
```

## First Setup

1. Install dependencies:

```bash
npm install
npx playwright install chromium
```

2. Create local secrets:

```bash
cp secrets/.env.example secrets/.env
```

3. Fill values in `secrets/.env`.

4. Choose concert config:

```bash
npm run start -- --bots 5 --concert config/concerts/rookie-divos.yaml
```

## Secrets

`config/accounts.yaml` points to env-var names. Secret values live in `secrets/.env`.

```yaml
reuse_first_account: true
accounts:
  - id: 1
    email_env: ACCOUNT_EMAIL
    pass_env: ACCOUNT_PASS
    citizen_id_env: ACCOUNT_CITIZEN_ID
```

Matching `secrets/.env`:

```dotenv
ACCOUNT_EMAIL=your-email@example.com
ACCOUNT_PASS=your-password
ACCOUNT_CITIZEN_ID=1234567890123
```

With `reuse_first_account: true`, `--bots 5` creates bot ids 1 through 5 using same credentials but separate browser profiles.

Set `reuse_first_account: false` and add account entries for one-account-per-bot routing.

## Settings

`config/settings.yaml` controls runtime behavior.

Important fields:

| Field | Meaning |
| --- | --- |
| `base_url` | Site opened on reset/startup. |
| `headless` | Run browser without visible window. Keep `false` for manual login/CAPTCHA. |
| `manual_solve_timeout` | Seconds to wait for manual page transitions. |
| `auto_login_on_startup` | Defaults to `true` if omitted. |
| `browser.channel` | `chrome` uses installed Google Chrome. Remove to use bundled Chromium. |
| `window` | Screen tiling settings for multiple browsers. |
| `telegram` | Alert delivery. Env-var names point to `secrets/.env`. |

## Concert Config

Minimal useful concert config:

```yaml
event_url: https://www.thaiticketmajor.com/concert/example.html
event_date: "2026-08-21"
target_round:
  date: "2026-08-21"
  time: "18:00"
  type: "offline"
sale_start: "2026-06-28T10:00:00+07:00"
zone_priority: ["SC", "SD", "SE"]
ticket_count: 2
seat_strategy:
  prefer_rows: []
  avoid_rows: []
  prefer_center: false
```

`target_round.type` options:

| Type | Meaning |
| --- | --- |
| `offline` | Physical venue concert. Excludes Live Streaming and RERUN. |
| `live_streaming` | TTM LIVE live stream product. |
| `rerun` | Replay product. |
| `any` | First matching date/time. Risky; avoid when multiple products share time. |

`go all` validates the exact target round before clicking. Wrong target or missing target becomes an error.

## Queue And Observability

Before `sale_start`, event-page reload cadence is 10-15 seconds. After `sale_start`, cadence is 5-10 seconds. Between reloads, bot polls DOM every 500 ms.

Forensic mode writes artifacts under `bot_data/runs/<run-id>/`.

```yaml
observability:
  mode: forensic
  artifact_root: bot_data/runs
  capture_html: true
  capture_screenshot: true
  capture_network_failures: true
  capture_console_errors: true
  keep_runs: 10
```

Use `minimal` for normal runs when you do not need artifacts.

## Validation

Run checks after config/schema changes:

```bash
npm run typecheck
npm test
```
