import type { PickedSeat } from "../ipc/types.ts";

export function formatSeatsSelectedMessage(botId: number, zone: string | undefined, picks: PickedSeat[], targetCount: number): string {
  if (picks.length === 0) return `Bot ${botId}: Payment page reached - Zone ${zone ?? "unknown"}, seats unknown`;
  const seatText = picks.map((seat) => `${seat.row}-${seat.col}`).join(", ");
  return `Bot ${botId}: Seats selected ${picks.length}/${targetCount} - Zone ${zone ?? "unknown"}, Seats ${seatText}`;
}
