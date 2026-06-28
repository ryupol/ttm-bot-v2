import { describe, expect, it } from "vitest";
import { formatSeatsSelectedMessage } from "../src/bot/seatAlert.ts";

describe("seatAlert", () => {
  it("includes selected and target seat counts", () => {
    const message = formatSeatsSelectedMessage(3, "B2", [
      { id: "checkseat-A-1", row: "A", col: 1 },
      { id: "checkseat-A-4", row: "A", col: 4 },
    ], 4);

    expect(message).toBe("Bot 3: Seats selected 2/4 - Zone B2, Seats A-1, A-4");
  });

  it("does not report zero selected seats as success", () => {
    const message = formatSeatsSelectedMessage(1, "C2", [], 2);

    expect(message).toBe("Bot 1: Payment page reached - Zone C2, seats unknown");
  });
});
