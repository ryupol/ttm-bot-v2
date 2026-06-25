export type PageKind =
  | "login"
  | "verify_condition"
  | "verify"
  | "queue"
  | "zones"
  | "fixed"
  | "payment"
  | "enroll"
  | "error"
  | "event"
  | "home"
  | "unknown";

export const MAX_VISITS: Record<PageKind, number> = {
  login: 2,
  verify_condition: 2,
  verify: 3,
  queue: 1,
  zones: 3,
  fixed: 5,
  enroll: 2,
  payment: 1,
  error: 2,
  home: 2,
  event: 3,
  unknown: 1,
};

export function classifyPage(url: string): PageKind {
  if (url.includes("signin.php") || url.includes("/user/login")) return "login";
  if (url.includes("verify_condition.php")) return "verify_condition";
  if (url.includes("verify.php")) return "verify";
  if (url.includes("/queue")) return "queue";
  if (url.includes("zones.php")) return "zones";
  if (url.includes("fixed.php")) return "fixed";
  if (url.includes("paymentall.php")) return "payment";
  if (url.includes("enroll.php")) return "enroll";
  if (url.includes("error.php")) return "error";
  if (url.includes("/performance/") || url.includes("/concert/")) return "event";
  if (url.includes("index.html") || url.replace(/\/$/, "").endsWith(".com")) return "home";
  return "unknown";
}
