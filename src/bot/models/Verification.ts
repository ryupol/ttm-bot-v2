export type VerifyResult =
  | { status: "passed" }
  | { status: "not_verify_page" }
  | { status: "missing_citizen_id" }
  | { status: "failed"; error?: string };

export type VerifyConditionResult =
  | { status: "submitted" }
  | { status: "not_verify_condition_page" }
  | { status: "confirm_not_found" };
