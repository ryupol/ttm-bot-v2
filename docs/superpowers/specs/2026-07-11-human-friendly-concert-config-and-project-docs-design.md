# Human-Friendly Concert Config and Project Documentation Design

## Goal

Make new concert setup safe and approachable for humans by reducing each concert file to event-specific values, while preserving advanced overrides. Improve project documentation and publish project under MIT license.

## Concert Config Interface

Each concert file should normally contain only:

```yaml
event_url: https://www.thaiticketmajor.com/performance/example.html

target_round:
  date: "2026-12-15"
  time: "18:00"

sale_start: "2026-10-01T10:00:00+07:00"
zone_priority: ["A1", "A2", "B1"]
ticket_count: 2
```

`event_url`, `target_round`, and `ticket_count` identify booking target. `sale_start` controls event-page reload cadence around sale opening. `zone_priority` controls preferred zone order. Empty zone priority remains valid and leaves bot waiting for user choice on zone page.

`target_round.type` defaults to `offline`. Users may explicitly set `live_streaming`, `rerun`, or `any`. `any` remains documented as risky when multiple products share same date and time.

Remove unused `event_date` field from concert schema and project-owned concert files. Round date remains single source of truth in `target_round.date`.

## Defaults and Compatibility

Zod schema owns runtime defaults. Entire nested sections become optional inputs:

- `seat_strategy`: empty preferred/avoided rows, center preference enabled.
- `selectors`: current buy-button and zone-link selectors.
- `queue_indicators`: current queue, verification, CAPTCHA, and puzzle indicators.
- `observability`: current minimal-mode defaults.
- `seat_retry_limit`: 7.
- `max_zone_cycles`: 0, meaning unlimited.
- `zone_cycle_alert_every`: 5.
- `zone_priority`: empty list.
- `target_round.type`: `offline`.

Existing advanced keys remain accepted and override defaults. No shared defaults file or custom deep-merge layer will be added. Parsed `Concert` output stays fully populated for runtime consumers.

## Human Workflow

Add `config/concerts/_template.yaml` as canonical copy target. Template contains concise comments explaining where values come from and which fields may be omitted. Creation flow:

```bash
cp config/concerts/_template.yaml config/concerts/my-concert.yaml
```

User edits event URL, round date/time, sale start, zone order, and ticket count, then starts bot with:

```bash
npm run start -- --bots 5 --concert config/concerts/my-concert.yaml
```

Existing named concert files migrate to minimal shape so users see realistic examples instead of copied internals.

## Documentation

README will explain:

- Project purpose: TypeScript, Playwright, and Ink TUI assistant for multiple Thai Ticket Major browser sessions.
- Key capabilities and human-controlled boundaries: login, CAPTCHA/manual challenges, and payment remain visible/manual where required.
- Installation, secrets, accounts, concert creation, start commands, sale-day flow, TUI commands, emergency recovery, artifacts, checks, and project structure.
- Responsible-use note requiring users to follow Thai Ticket Major terms and applicable rules.
- MIT badge and license link.

`docs/config.md` remains detailed source for all config fields. It will lead with minimal copy-and-edit workflow, explain each minimal field, then list optional advanced overrides and defaults. Commands and examples must match repository scripts and files.

## License

Add standard MIT license at repository root:

```text
Copyright (c) 2026 Ryu Polawat
```

README will link to `LICENSE` and identify project as MIT licensed.

## Error Handling

Config parsing continues to fail fast through Zod. Invalid URLs, timestamps without UTC offset, invalid round types, non-positive ticket counts, and malformed advanced overrides remain startup errors. Documentation will show required ISO timestamp format with Bangkok offset: `YYYY-MM-DDTHH:mm:ss+07:00`.

No new config generator or merge mechanism is added, avoiding new file-system and validation failure paths.

## Validation

Config tests will verify:

- Canonical minimal config parses.
- All advanced defaults are materialized in parsed output.
- `target_round.type` defaults to `offline`.
- Explicit advanced settings still override defaults.
- Every project-owned YAML file under `config/concerts/`, including template, parses successfully.
- Existing named concert expectations remain correct after migration.

Final checks:

```bash
npm test
npm run typecheck
```

README links, commands, and YAML examples will be checked against repository paths, `package.json`, and schema.

## Scope

Included: concert schema defaults, template, migration of existing concert YAML, config tests, README, config guide, MIT license.

Excluded: interactive config generator, scraping concert metadata, shared defaults file, account schema redesign, bot flow behavior changes, new dependencies.
