export type ManualInterventionReason =
  | "login"
  | "captcha"
  | "verify"
  | "terms"
  | "unknown_page"
  | "queue_presence_confirm"
  | "forbidden"
  | "too_many_requests";

export type ManualInterventionState = {
  present: false;
} | {
  present: true;
  reason: ManualInterventionReason;
  detail?: string;
  userMessage: string;
};

export type ManualInterventionTransition = "appeared" | "cleared" | "unchanged";
