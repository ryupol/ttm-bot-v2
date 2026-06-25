import type { SeatStrategy } from "../config/schema.js";

export type AvailableSeat = {
  id: string;
  row: number;
  col: number;
  rowLabel?: string;
};

export function pickSeats(
  available: AvailableSeat[],
  count: number,
  strategy: SeatStrategy,
  totalCols: number,
): AvailableSeat[] {
  const preferRows = strategy.prefer_rows ?? [];
  const avoidRows = new Set(strategy.avoid_rows ?? []);
  const preferCenter = strategy.prefer_center !== false;

  const filtered = available.filter((seat) => !avoidRows.has(seat.row) && !avoidRows.has(seat.rowLabel ?? ""));
  if (filtered.length === 0) return [];

  const byRow = new Map<number, AvailableSeat[]>();
  for (const seat of filtered) {
    const rowSeats = byRow.get(seat.row) ?? [];
    rowSeats.push(seat);
    byRow.set(seat.row, rowSeats);
  }

  const allRows = [...byRow.keys()].sort((a, b) => a - b);
  const midRow = (allRows[0] + allRows[allRows.length - 1]) / 2;
  const centerCol = totalCols / 2;

  const preferredRows = preferRows
    .map((row) => resolvePreferredRow(row, byRow))
    .filter((row): row is number => row !== undefined);
  const preferredSet = new Set(preferredRows);

  const extraRows = allRows.filter((row) => !preferredSet.has(row));
  if (preferCenter) extraRows.sort((a, b) => Math.abs(a - midRow) - Math.abs(b - midRow));
  else extraRows.sort((a, b) => a - b);

  const searchOrder = [...preferredRows, ...extraRows];
  const target = Math.min(count, filtered.length);

  for (const row of searchOrder) {
    const rowSeats = sortedByCol(byRow.get(row) ?? []);
    const run = bestContiguousRun(rowSeats.map((seat) => seat.col), target, centerCol);
    if (run) return rowSeats.filter((seat) => seat.col >= run.start && seat.col <= run.end);
  }

  let seed: AvailableSeat[] | undefined;
  for (const row of searchOrder) {
    const rowSeats = sortedByCol(byRow.get(row) ?? []);
    const cols = rowSeats.map((seat) => seat.col);
    for (let desiredCount = target - 1; desiredCount > 0; desiredCount -= 1) {
      const run = bestContiguousRun(cols, desiredCount, centerCol);
      if (!run) continue;
      seed = rowSeats.filter((seat) => seat.col >= run.start && seat.col <= run.end);
      break;
    }
    if (seed) break;
  }

  if (seed) {
    const pickedIds = new Set(seed.map((seat) => seat.id));
    const seedCenterCol = (seed[0].col + seed[seed.length - 1].col) / 2;
    const seedRow = seed[0].row;
    const pool = filtered
      .filter((seat) => !pickedIds.has(seat.id))
      .sort((a, b) => scoreNearSeed(a, seedRow, seedCenterCol) - scoreNearSeed(b, seedRow, seedCenterCol));
    return [...seed, ...pool].slice(0, target);
  }

  return [...filtered].sort((a, b) => Math.abs(a.col - centerCol) - Math.abs(b.col - centerCol)).slice(0, target);
}

export function bestContiguousRun(cols: number[], count: number, centerCol: number): { start: number; end: number } | undefined {
  let best: { start: number; end: number } | undefined;
  let bestDist = Number.POSITIVE_INFINITY;
  for (let i = 0; i <= cols.length - count; i += 1) {
    const run = cols.slice(i, i + count);
    if (run[run.length - 1] - run[0] !== count - 1) continue;
    const mid = (run[0] + run[run.length - 1]) / 2;
    const dist = Math.abs(mid - centerCol);
    if (dist < bestDist) {
      bestDist = dist;
      best = { start: run[0], end: run[run.length - 1] };
    }
  }
  return best;
}

function sortedByCol(seats: AvailableSeat[]): AvailableSeat[] {
  return [...seats].sort((a, b) => a.col - b.col);
}

function scoreNearSeed(seat: AvailableSeat, seedRow: number, seedCenterCol: number): number {
  return Math.abs(seat.row - seedRow) * 1000 + Math.abs(seat.col - seedCenterCol);
}

function resolvePreferredRow(value: string | number, byRow: Map<number, AvailableSeat[]>): number | undefined {
  if (typeof value === "number") return byRow.has(value) ? value : undefined;
  for (const [row, seats] of byRow) {
    if (seats.some((seat) => seat.rowLabel === value)) return row;
  }
  return undefined;
}
