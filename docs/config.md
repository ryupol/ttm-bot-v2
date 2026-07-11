# Config Guide

Project uses YAML for non-secret values and `secrets/.env` for credentials and Telegram secrets.

## Config Files

```text
config/settings.yaml      browser, windows, login, Telegram
config/accounts.yaml      account routing and env-var names
config/concert.yaml       default concert
config/concerts/*.yaml    named concerts and copyable template
secrets/.env              local secret values; ignored by git
```

## First Setup

```bash
npm install
npx playwright install chromium
cp secrets/.env.example secrets/.env
cp config/concerts/_template.yaml config/concerts/my-concert.yaml
```

Fill `secrets/.env`, edit `my-concert.yaml`, then run:

```bash
npm run start -- --bots 5 --concert config/concerts/my-concert.yaml
```

## Create Concert Config

Start from template:

```bash
cp config/concerts/_template.yaml config/concerts/concert-name.yaml
```

Minimal config:

```yaml
event_url: https://www.thaiticketmajor.com/performance/example.html

target_round:
  date: "2027-12-15"
  time: "18:00"

sale_start: "2027-10-01T10:00:00+07:00"
zone_priority: ["A1", "A2", "B1"]
ticket_count: 2
```

### Values Humans Usually Edit

| Field | Required for normal booking | Meaning |
| --- | --- | --- |
| `event_url` | Yes | Full TTM event or performance page URL. |
| `target_round.date` | Yes | Desired show date in `YYYY-MM-DD`. |
| `target_round.time` | Yes | Desired show time in `HH:mm`, matching displayed round. |
| `sale_start` | Recommended | Sale opening timestamp. Must include UTC offset; Thailand uses `+07:00`. |
| `zone_priority` | Recommended | Zone codes tried left to right. Empty list pauses on zone page for user choice. |
| `ticket_count` | Yes | Positive number of seats bot attempts to select together. |

Example timestamp:

```text
2027-10-01T10:00:00+07:00
```

Do not use `2027-10-01 10:00` or omit `+07:00`; schema requires ISO datetime with offset.

### Round Types

Physical venue events default to `offline`, so omit type. Set it only when needed:

```yaml
target_round:
  date: "2027-12-15"
  time: "18:00"
  type: live_streaming
```

| Type | Matching behavior |
| --- | --- |
| `offline` | Physical venue round; excludes live streaming and rerun products. Default. |
| `live_streaming` | TTM LIVE streaming product. |
| `rerun` | Replay product. |
| `any` | First matching date/time, regardless of product. Risky when products share time. |

`go` requires exact target round. Missing or mismatched target fails instead of clicking another round.

## Advanced Concert Overrides

Most concerts should keep schema defaults. Add only override you understand.

```yaml
queue_start: "2027-10-01T09:00:00+07:00"
seat_retry_limit: 7
max_zone_cycles: 0
zone_cycle_alert_every: 5

seat_strategy:
  prefer_rows: [5, 6, 7]
  avoid_rows: [1, 2]
  prefer_center: true

selectors:
  buy_now_btn: "a.btn-buynow"
  zone_link: "a[href*='zone={zone}']"

queue_indicators:
  queue_url_pattern: "/queue"
  verify_url_pattern: "/verify.php"
  captcha_selector: "img.captcha, iframe[src*='recaptcha']"
  puzzle_selector: ".puzzle-slider, .geetest"

observability:
  mode: minimal
  artifact_root: bot_data/runs
  capture_html: true
  capture_screenshot: true
  capture_network_failures: true
  capture_console_errors: true
  keep_runs: 10
```

| Field | Default | Meaning |
| --- | --- | --- |
| `queue_start` | unset | Optional timestamp stored with forensic run metadata. |
| `seat_retry_limit` | `7` | Attempts to select seats on fixed-seat page. |
| `max_zone_cycles` | `0` | Full zone passes before stopping; `0` means unlimited. |
| `zone_cycle_alert_every` | `5` | Send still-searching alert every N zone cycles. |
| `seat_strategy.prefer_rows` | `[]` | Rows tried before other rows. Numbers and strings accepted. |
| `seat_strategy.avoid_rows` | `[]` | Rows excluded from selection. |
| `seat_strategy.prefer_center` | `true` | Prefer blocks nearest center. |
| `selectors.buy_now_btn` | `a.btn-buynow` | Event buy-button selector. |
| `selectors.zone_link` | `a[href*='zone={zone}']` | Zone link pattern; `{zone}` replaced with zone code. |
| `queue_indicators.queue_url_pattern` | `/queue` | URL fragment identifying queue page. |
| `queue_indicators.verify_url_pattern` | `/verify.php` | URL fragment identifying verification page. |
| `queue_indicators.captcha_selector` | built-in CAPTCHA selectors | Selector used to detect CAPTCHA. |
| `queue_indicators.puzzle_selector` | built-in puzzle selectors | Selector used to detect slider/puzzle challenge. |
| `observability.mode` | `minimal` | `forensic` writes evidence; `minimal` avoids run artifact capture. |
| `observability.artifact_root` | `bot_data/runs` | Root directory for forensic runs. |
| `observability.capture_*` | `true` | Enable individual forensic evidence types. |
| `observability.keep_runs` | `10` | Number of forensic run directories retained. |

## Accounts and Secrets

`config/accounts.yaml` contains env-var names, never secret values:

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

With `reuse_first_account: true`, requested bot count reuses first account credentials across separate browser profiles. With `false`, add one account entry per bot.

Startup fails with `Missing env vars referenced by config` when YAML references unset value.

## Settings

`config/settings.yaml` controls shared runtime behavior:

| Field | Default | Meaning |
| --- | --- | --- |
| `base_url` | required | Site opened on reset and startup. |
| `headless` | `false` | Hide browser when true. Keep false for manual steps. |
| `manual_solve_timeout` | `300` | Seconds to wait for manual page transition. |
| `auto_login_on_startup` | `true` | Check session and start login flow when workers open. |
| `debug` | `false` | Enable extra debug behavior. |
| `browser.name` | `chromium` | Playwright browser engine. |
| `browser.channel` | unset | `chrome` selects installed Google Chrome. |
| `window.screen_width` | `1440` | Screen width used for window tiling. |
| `window.screen_height` | `900` | Screen height used for window tiling. |
| `window.gap` | `8` | Gap between tiled browser windows. |

## Telegram

Settings refer to secret names:

```yaml
telegram:
  enabled: true
  token_env: TELEGRAM_TOKEN
  chat_id_env: TELEGRAM_CHAT_ID
```

Values belong in `secrets/.env`:

```dotenv
TELEGRAM_TOKEN=123456789:replace-me
TELEGRAM_CHAT_ID=123456789
```

Disable Telegram when values are unavailable:

```yaml
telegram:
  enabled: false
```

## Validation and Common Errors

Run checks after any config or schema edit:

```bash
npm test -- tests/config.test.ts
npm run typecheck
```

Common startup errors:

| Error | Fix |
| --- | --- |
| `Required` | Add missing required field shown in Zod error path. |
| `Invalid url` | Use full `https://...` event URL. |
| `Invalid datetime` | Use ISO timestamp with offset, such as `2027-10-01T10:00:00+07:00`. |
| `Missing env vars referenced by config` | Match account/settings env names to `secrets/.env`. |
| `Target round not found` | Match TTM date, time, type, and event URL exactly. |
