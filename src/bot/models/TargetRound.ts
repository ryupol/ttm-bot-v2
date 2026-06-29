export type TargetRoundState = {
  dataButton: string;
  dateText: string;
  timeText: string;
  type: "offline" | "live_streaming" | "rerun" | "any";
  disabled: boolean;
  soldOut: boolean;
  href: string;
  onclick: string;
  label: string;
  requiresLogin: boolean;
  queueOrBookingCapable: boolean;
};
