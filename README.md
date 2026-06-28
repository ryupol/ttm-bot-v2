# TTM Bot v2

TypeScript + Playwright rewrite for running multiple Thai Ticket Major browser sessions from one Ink TUI.

## Setup

```bash
npm install
npx playwright install chromium
npm run start -- --bots 5
```

Browsers open with persistent profiles under `bot_data/worker_N`. Startup auto-login is enabled by default: each bot checks the event page, skips if already logged in or done, otherwise opens the login page and prefills credentials for manual submit.

Default browser is installed Google Chrome via `browser.channel: chrome`. Remove `channel` to use bundled Playwright Chromium after running `npx playwright install chromium`.

## Start Commands

Default config, five browser sessions:

```bash
npm run start -- --bots 5
```

Specific concert config:

```bash
npm run start -- --bots 5 --concert config/concerts/rookie-divos.yaml
```

Optional config overrides:

```bash
npm run start -- --bots 5 --concert config/concert.yaml --settings config/settings.yaml --accounts config/accounts.yaml
```

Browsers use persistent profiles under `bot_data/worker_N`. `auto_login_on_startup: true` is the default. `login all` remains available as a manual retry command; it skips bots that are already logged in or already done, and only opens the login page for bots that need login.

`config/accounts.yaml` defaults to reusing one account across all requested bots:

```yaml
reuse_first_account: true
accounts:
  - id: 1
    email_env: ACCOUNT_EMAIL
    pass_env: ACCOUNT_PASS
    citizen_id_env: ACCOUNT_CITIZEN_ID
```

With `--bots 5`, bot ids 1 through 5 use the same credentials but keep separate browser profiles. Set `reuse_first_account: false` and add more account entries for one-account-per-bot routing.

## TUI Commands

Targets are `all` or one bot number, for example `login all`, `go 4`, or `stop 4`.

| Command | When to Use | What It Does |
| --- | --- | --- |
| `login all` / `login N` | Manual retry when startup login was disabled, interrupted, or bot shows `Login required`. | Checks whether bot is already logged in. If yes, marks `READY Logged in` and skips. If no, opens signin page, fills username/password from account config, and waits for you to submit manually. Skips bots already on payment/enroll pages. |
| `check all` | Diagnostic command after manual browser changes. | Reads current URL/HTML, classifies each bot page, and updates TUI state without clicking or navigating. |
| `go N` / `go all` | Main start/resume command. | Uses current page classification. Event/home starts queue acquisition; queue pages stay in queue handling; zone pages select the next configured zone; `fixed.php` resumes seat selection; payment/enroll pages mark done and skip. |
| `stop N` | Stop one bot or cancel bad run. | Stops bot `N`. Browser remains open. |
| `reset N` | Return bot to base site/manual login state. | Navigates to `base_url`, and marks bot `IDLE`. |
| `log N` | Focus logs for one bot during incident handling. | Filters TUI log panel to bot `N`. |
| `log all` | Return to combined logs. | Shows all bot logs again. |

## Sale-Day Flow

1. Start five sessions:

```bash
npm run start -- --bots 5
```

2. Startup auto-login opens login pages and prefills credentials for bots that need login. Submit login manually in those browsers. If a bot is already logged in, it stays logged in and shows `READY Logged in`.

3. Check bot states:

```text
check all
```

Expected state after successful login: `READY Logged in`.

4. Start queue acquisition or resume from current page:

```text
go all
```

Expected state:

```text
WATCHING_QUEUE_OPEN
```

Before `sale_start`, event-page reload cadence is 10-15 seconds. After `sale_start`, cadence is 5-10 seconds. Between reloads, bot polls DOM every 500 ms. Acquisition does not stop because sale start passed.

5. If queue opens, bot enters:

```text
IN_QUEUE
```

Do not refresh or manually navigate queue page unless you intentionally take over.

Queue-it wait pages and Gatekeeper inflow pages are preserved. The bot does not reload while queue-like. Queue-it "Still here?" visitor-presence prompts are auto-clicked only on guarded Queue-it wait pages. CAPTCHA remains manual.

6. If manual step appears:

```text
MANUAL_INTERVENTION
```

Solve in browser. Bot alerts once per appearance. After solving, use `go N` if bot does not continue automatically.

7. On seat page:

```text
BOOKING
```

Bot selects seats using configured zone priority and seat strategy.

## Queue-Ready Runbook

Configure `target_round`, optional `sale_start`, and `observability` in `config/concert.yaml`, or select a concert file with `--concert`.

Example:

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

sale_start: "2026-06-28T10:00:00+07:00"

observability:
  mode: forensic
  artifact_root: bot_data/runs
  capture_html: true
  capture_screenshot: true
  capture_network_failures: true
  capture_console_errors: true
  keep_runs: 10
```

`go all` validates the exact target round and starts queue acquisition immediately. If a bot is already on a queue, zone, fixed, payment, or enroll page, `go N` resumes or marks done from that page instead of restarting blindly.

Forensic artifacts are written under `bot_data/runs/<run-id>/` when `observability.mode` is `forensic`.

## Emergency Notes

- Wrong target or missing target: bot errors instead of clicking fallback button.
- Need immediate start: run `go all`.
- Need pause one bot: run `stop N`.
- Need resume after manual browser work: run `go N` from current page.
- Need inspect evidence: check `bot_data/runs/<run-id>/events.jsonl` and per-bot screenshots/HTML.
- Done pages: `paymentall.php` and `enroll.php` both mark bot `DONE` and are skipped by `login all` / `go all`.

## Checks

```bash
npm run typecheck
npm test
```
