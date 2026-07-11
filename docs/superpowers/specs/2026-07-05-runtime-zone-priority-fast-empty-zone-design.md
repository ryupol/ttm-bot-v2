# Runtime Zone Priority and Fast Empty-Zone Exit Design

## Problem

During booking, best zone preference can change after bots reach booking pages. Current zone priority comes from concert YAML and cannot be changed for the active run.

Fixed seat pages can also waste time when a zone has only unavailable seats. The bot waits for available-seat DOM before returning `no_seats`; if the page contains only unavailable seats such as `<div class="seatnotavail">&nbsp;</div>`, it can spend the full wait timeout before leaving the zone.

## Goals

- Let operator change zone priority during the current run.
- Apply changed priority immediately on `zones.php`.
- If already on `fixed.php`, finish one fast scan of the current zone, then use the new priority.
- Reset tried-zone bookkeeping after priority changes.
- Exit zones quickly when fixed page has seat DOM but zero available seats.
- Avoid clicking the Thai "available seats" filter button.
- Avoid clicking unavailable seat elements.

## Non-Goals

- Do not persist runtime zone changes into YAML.
- Do not add config reload.
- Do not change ticket count or seat strategy in this feature.
- Do not automate manual booking steps outside existing flow.

## Command Interface

Add a TUI command:

```text
zone all SC SD SE
zone 2 A2 A3 C2
```

The command supports the same target shape as existing commands:

- `all` updates every running bot.
- `N` updates one running bot.

At least one zone code is required. Empty input such as `zone 2` is invalid and should return a usage error.

The command is current-run only. Restarting the app reloads `concert.zone_priority` from YAML.

## Runtime Behavior

Each worker receives a `set_zone_priority` command with the new ordered zone list.

`BookingService` stores a runtime zone priority override. Zone selection reads:

```text
runtimeZonePriority ?? concert.zone_priority
```

When the override changes:

- Clear `zonesTried`.
- Reset zone cycle count.
- Log the new priority.
- Keep the current fixed-page scan if one is already in progress.

If the bot is on `zones.php`, the next zone click uses the new priority immediately.

If the bot is on `fixed.php`, the selector completes one scan of the current zone. If that scan does not confirm seats, the next zone selection starts from the new priority with fresh tried-zone state.

## Fast Empty-Zone Exit

On `fixed.php`, the selector should distinguish between:

- Seat map not loaded yet.
- Seat map loaded with available seats.
- Seat map loaded with no available seats.

Detection rule:

1. Wait for any fixed-page seat marker:
   - `div[id^='checkseat-']`
   - `.seatnotavail`
   - `.seatuncheck`
   - `.seatchecked`
2. After first marker appears, settle briefly, about 300 ms.
3. If `.seatuncheck` count is zero, return `no_seats`.
4. If `.seatuncheck` exists, continue existing seat-pick flow.

This keeps the bot from waiting for the full available-seat timeout when the page already shows only unavailable seats.

The click selector remains limited to available seats:

```text
div[id^='checkseat-'].seatuncheck
```

Unavailable seats such as `.seatnotavail` are not clicked.

## Components

- `src/ipc/commands.ts`
  - Parse `zone all|N ZONE...`.
  - Keep existing command behavior unchanged.

- `src/ipc/types.ts`
  - Add a main-to-worker command for setting runtime zone priority.

- `src/main.ts` and runtime command dispatch
  - Route parsed zone command to selected workers.
  - Report parse or dispatch errors through existing log path.

- `src/bot/runtime/BotRuntime.ts`
  - Accept `set_zone_priority`.
  - Call booking service update method.

- `src/bot/booking/BookingService.ts`
  - Add runtime priority override.
  - Add `setZonePriority(zones: string[])`.
  - Clear tried zones and reset cycles on update.
  - Use effective priority everywhere zone selection occurs.

- `src/bot/booking/FixedPageSeatSelector.ts`
  - Replace available-seat-only wait with seat-map-state wait.
  - Return `no_seats` immediately after settled loaded map has zero `.seatuncheck`.

## Error Handling

- Invalid `zone` command shows usage error and does not touch workers.
- Unknown bot target keeps existing target resolution behavior.
- Empty zone list is rejected.
- If worker receives an empty zone list defensively, it rejects or ignores with a log message.
- If page navigates away during fixed-page wait, preserve existing behavior: secured booking URL means confirmed; non-fixed page returns `null` for router handling.

## Observability

Log each runtime priority change:

```text
zone priority updated: SC, SD, SE
```

Forensics should capture the new effective priority when zone selection starts if the existing event structure has a suitable field. This is optional for first implementation if normal logs already include the update.

## Testing

Add unit tests for:

- Command parsing:
  - `zone all SC SD SE`
  - `zone 2 A2 A3`
  - invalid `zone 2`
  - invalid target still fails

- Booking service priority behavior:
  - runtime priority replaces YAML priority.
  - setting runtime priority clears tried zones.
  - setting priority on zones page affects next selected zone.

- Fixed page selector:
  - unavailable-only DOM returns `no_seats` without waiting for full available-seat timeout.
  - available `.seatuncheck` still invokes existing pick flow.
  - navigation during wait preserves current secured/non-fixed behavior.

## Open Decisions

None. Decisions from grilling:

- Current fixed zone gets one scan before new priority applies.
- Command supports both `all` and single bot target.
- Runtime only; no YAML write.
- Fast empty-zone rule uses loaded seat DOM plus zero `.seatuncheck`.
- Runtime priority changes clear `zonesTried`.
- On `zones.php`, new priority applies immediately.
