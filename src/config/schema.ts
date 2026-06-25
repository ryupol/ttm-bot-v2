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
  debug: z.boolean().default(false),
  browser: BrowserSchema.default({ name: "chromium" }),
  window: WindowSchema.default({ screen_width: 1440, screen_height: 900, gap: 8 }),
  telegram: TelegramSchema.default({ enabled: false }),
});

export const AccountFileSchema = z.object({
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

export const ConcertSchema = z.object({
  event_url: z.string().url(),
  event_date: z.string(),
  zone_priority: z.array(z.string()).default([]),
  ticket_count: z.number().int().positive(),
  seat_retry_limit: z.number().int().positive().default(7),
  seat_strategy: SeatStrategySchema,
  selectors: z.object({
    buy_now_btn: z.string().default("a.btn-buynow"),
    zone_link: z.string().default("a[href*='zone={zone}']"),
  }),
  queue_indicators: z.object({
    queue_url_pattern: z.string().default("/queue"),
    verify_url_pattern: z.string().default("/verify.php"),
    captcha_selector: z.string().default("img.captcha, iframe[src*='recaptcha']"),
    puzzle_selector: z.string().default(".puzzle-slider, .geetest"),
  }),
});

export type Settings = z.infer<typeof SettingsSchema>;
export type AccountFile = z.infer<typeof AccountFileSchema>;
export type Concert = z.infer<typeof ConcertSchema>;
export type SeatStrategy = z.infer<typeof SeatStrategySchema>;

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
