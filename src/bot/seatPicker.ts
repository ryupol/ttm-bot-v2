import type { SeatStrategy } from "../config/schema.ts";

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
  const avoidRows = new Set(strategy.avoid_rows ?? []);
  void totalCols;

  const filtered = available.filter((seat) => !avoidRows.has(seat.row) && !avoidRows.has(seat.rowLabel ?? ""));
  const target = Math.min(count, filtered.length);
  return filtered.slice(0, target);
}
