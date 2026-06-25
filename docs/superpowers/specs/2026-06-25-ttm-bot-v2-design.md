# TTM Bot v2 Design

## Summary

V2 is a TypeScript + Playwright rewrite. Main process owns the Ink TUI and dispatches commands. Each bot runs in a `worker_threads` worker with one persistent Playwright profile under `bot_data/worker_N`.

## Flow

1. Worker opens a browser and waits in `IDLE`.
2. User logs in manually.
3. `prepare all` loads the event page and marks bots `READY`.
4. `set-time HH:MM:SS` schedules a shared start; `go all` overrides it.
5. Queue pages are monitored with jittered polling and manual CAPTCHA alerts.
6. Queue exit moves bot to `AWAITING_USER`; user fills TTM form manually.
7. `assign N` tells the worker to handle current page. If on `fixed.php`, it injects seat-selection JS and confirms.

## Config

Config is YAML plus local `.env`. Secrets stay in `secrets/.env`, ignored by git.

## Seat Selection

Seat picking ports v1 behavior: prefer/avoid rows, center preference, contiguous-run first, seed+fill fallback, then individual center picks. Browser JS dispatches `mousedown`, `mouseup`, and `click` because TTM seat toggles depend on mouse events.
