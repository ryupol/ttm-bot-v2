import { describe, expect, it } from "vitest";
import { bestContiguousRun, pickSeats, type AvailableSeat } from "../src/bot/seatPicker.js";
import type { SeatStrategy } from "../src/config/schema.js";

const centerStrategy: SeatStrategy = {
  prefer_rows: [],
  avoid_rows: [],
  prefer_center: true,
};

describe("seatPicker", () => {
  it("picks full adjacent block closest to center", () => {
    const seats = row(5, [1, 2, 3, 7, 8, 9]);
    const picked = pickSeats(seats, 3, centerStrategy, 12);
    expect(picked.map((seat) => seat.col)).toEqual([7, 8, 9]);
  });

  it("uses preferred rows before center rows", () => {
    const seats = [...row(1, [4, 5]), ...row(5, [4, 5])];
    const picked = pickSeats(seats, 2, { ...centerStrategy, prefer_rows: [1] }, 10);
    expect(picked.map((seat) => seat.row)).toEqual([1, 1]);
  });

  it("filters avoided numeric and label rows", () => {
    const seats = [...row(1, [4, 5], "A"), ...row(2, [4, 5], "B")];
    const picked = pickSeats(seats, 2, { ...centerStrategy, avoid_rows: ["A"] }, 10);
    expect(picked.map((seat) => seat.rowLabel)).toEqual(["B", "B"]);
  });

  it("falls back from largest adjacent seed to nearest fill seats", () => {
    const seats = [...row(3, [4, 5]), ...row(4, [1])];
    const picked = pickSeats(seats, 3, centerStrategy, 10);
    expect(picked.map((seat) => seat.id)).toEqual(["3-4", "3-5", "4-1"]);
  });

  it("caps target at available seats", () => {
    const picked = pickSeats(row(3, [4, 5]), 4, centerStrategy, 10);
    expect(picked).toHaveLength(2);
  });

  it("finds contiguous run nearest center", () => {
    expect(bestContiguousRun([1, 2, 3, 7, 8, 9], 3, 6)).toEqual({ start: 7, end: 9 });
  });
});

function row(rowNumber: number, cols: number[], rowLabel = String(rowNumber)): AvailableSeat[] {
  return cols.map((col) => ({
    id: `${rowNumber}-${col}`,
    row: rowNumber,
    rowLabel,
    col,
  }));
}
