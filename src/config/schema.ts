import { z } from "zod";

const BrowserSchema = z.object({
  name: z.enum(["chromium"]).default("chromium"),
  channel: z.string().optional(),
});

const WindowSchema = z.object({
  screen_width: z.number().int().positive().default(1440),
  screen_height: z.number().int().positive().default(900),
  gap: z.number().int().nonnegative().default(8),
});

const TelegramSchema = z.object({
  enabled: z.boolean().default(false),
  token_env: z.string().default("TELEGRAM_TOKEN"),
  chat_id_env: z.string().default("TELEGRAM_CHAT_ID"),
});

export const SettingsSchema = z.object({
  base_url: z.string().url(),
  headless: z.boolean().default(false),
  manual_solve_timeout: z.number().int().positive().default(300),
  auto_login_on_startup: z.boolean().default(true),
  debug: z.boolean().default(false),
  browser: BrowserSchema.default({ name: "chromium" }),
  window: WindowSchema.default({ screen_width: 1440, screen_height: 900, gap: 8 }),
  telegram: TelegramSchema.default({ enabled: false }),
});

export const AccountFileSchema = z.object({
  reuse_first_account: z.boolean().default(false),
  accounts: z.array(
    z.object({
      id: z.number().int().positive(),
      email_env: z.string().optional(),
      pass_env: z.string().optional(),
      citizen_id_env: z.string().optional(),
    }),
  ),
});

export const SeatStrategySchema = z.object({
  prefer_rows: z.array(z.union([z.number(), z.string()])).default([]),
  avoid_rows: z.array(z.union([z.number(), z.string()])).default([]),
  prefer_center: z.boolean().default(true),
});

const TargetRoundSchema = z.object({
  date: z.string(),
  time: z.string(),
  type: z.enum(["offline", "live_streaming", "rerun", "any"]).default("offline"),
});

const ObservabilitySchema = z.object({
  mode: z.enum(["forensic", "minimal"]).default("minimal"),
  artifact_root: z.string().default("bot_data/runs"),
  capture_html: z.boolean().default(true),
  capture_screenshot: z.boolean().default(true),
  capture_network_failures: z.boolean().default(true),
  capture_console_errors: z.boolean().default(true),
  keep_runs: z.number().int().positive().default(10),
});

const SelectorsSchema = z.object({
  buy_now_btn: z.string().default("a.btn-buynow"),
  zone_link: z.string().default("a[href*='zone={zone}']"),
});

const QueueIndicatorsSchema = z.object({
  queue_url_pattern: z.string().default("/queue"),
  verify_url_pattern: z.string().default("/verify.php"),
  captcha_selector: z.string().default("img.captcha, iframe[src*='recaptcha']"),
  puzzle_selector: z.string().default(".puzzle-slider, .geetest"),
});

export const ConcertSchema = z.object({
  event_url: z.string().url(),
  target_round: TargetRoundSchema.optional(),
  queue_start: z.string().datetime({ offset: true }).optional(),
  sale_start: z.string().datetime({ offset: true }).optional(),
  zone_priority: z.array(z.string()).default([]),
  max_zone_cycles: z.number().int().nonnegative().default(0),
  zone_cycle_alert_every: z.number().int().positive().default(5),
  ticket_count: z.number().int().positive(),
  seat_retry_limit: z.number().int().positive().default(7),
  seat_strategy: SeatStrategySchema.default({}),
  selectors: SelectorsSchema.default({}),
  queue_indicators: QueueIndicatorsSchema.default({}),
  observability: ObservabilitySchema.default({
    mode: "minimal",
    artifact_root: "bot_data/runs",
    capture_html: true,
    capture_screenshot: true,
    capture_network_failures: true,
    capture_console_errors: true,
    keep_runs: 10,
  }),
});

export type Settings = z.infer<typeof SettingsSchema>;
export type AccountFile = z.infer<typeof AccountFileSchema>;
export type Concert = z.infer<typeof ConcertSchema>;
export type SeatStrategy = z.infer<typeof SeatStrategySchema>;
export type TargetRound = z.infer<typeof TargetRoundSchema>;
export type Observability = z.infer<typeof ObservabilitySchema>;

export type ResolvedAccount = AccountFile["accounts"][number] & {
  email?: string;
  password?: string;
  citizenId?: string;
};

export type AppConfig = {
  rootDir: string;
  settings: Settings;
  concert: Concert;
};
