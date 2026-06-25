# TTM Bot v2

TypeScript + Playwright rewrite for running multiple Thai Ticket Major browser sessions from one Ink TUI.

## Setup

```bash
npm install
npx playwright install chromium
cp secrets/.env.example secrets/.env
npm run start -- --bots 5
```

Browsers open with persistent profiles under `bot_data/worker_N`. Log in manually in each browser, then use TUI commands.

Default browser is bundled Playwright Chromium. To use installed Google Chrome, set `browser.channel: chrome` in `config/settings.yaml`.

## Commands

- `prepare all`
- `go all`
- `stop 4`
- `reset 4`
- `log 3`
- `assign 3`
- `set-time HH:MM:SS`

## Checks

```bash
npm run typecheck
npm test
```
