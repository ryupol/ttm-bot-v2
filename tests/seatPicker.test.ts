import { describe, expect, it } from "vitest";
import { pickSeats, type AvailableSeat } from "../src/bot/seatPicker.ts";
import type { SeatStrategy } from "../src/config/schema.ts";

const centerStrategy: SeatStrategy = {
  prefer_rows: [],
  avoid_rows: [],
  prefer_center: true,
};

describe("seatPicker", () => {
  it("picks first available seats in input order", () => {
    const seats = row(5, [1, 2, 3, 7, 8, 9]);
    const picked = pickSeats(seats, 3, centerStrategy, 12);
    expect(picked.map((seat) => seat.col)).toEqual([1, 2, 3]);
  });

  it("does not require adjacent seats", () => {
    const seats = [...row(1, [1, 4]), ...row(2, [2])];
    const picked = pickSeats(seats, 3, centerStrategy, 10);
    expect(picked.map((seat) => seat.id)).toEqual(["1-1", "1-4", "2-2"]);
  });

  it("filters avoided numeric and label rows", () => {
    const seats = [...row(1, [4, 5], "A"), ...row(2, [4, 5], "B")];
    const picked = pickSeats(seats, 2, { ...centerStrategy, avoid_rows: ["A"] }, 10);
    expect(picked.map((seat) => seat.rowLabel)).toEqual(["B", "B"]);
  });

  it("preserves unsorted input order before picking", () => {
    const seats = [...row(2, [4]), ...row(1, [8, 1])];
    const picked = pickSeats(seats, 2, centerStrategy, 10);
    expect(picked.map((seat) => seat.id)).toEqual(["2-4", "1-8"]);
  });

  it("caps target at available seats", () => {
    const picked = pickSeats(row(3, [4, 5]), 4, centerStrategy, 10);
    expect(picked).toHaveLength(2);
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
