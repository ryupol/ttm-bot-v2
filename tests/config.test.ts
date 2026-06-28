import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { selectBotAccounts } from "../src/config/accounts.ts";
import { loadAppConfig } from "../src/config/load.ts";

describe("loadAppConfig", () => {
  it("loads YAML and resolves account env values", () => {
    const root = path.join(tmpdir(), `ttm-config-${Date.now()}`);
    mkdirSync(path.join(root, "config"), { recursive: true });
    mkdirSync(path.join(root, "secrets"), { recursive: true });
    writeFileSync(path.join(root, "config/settings.yaml"), settingsYaml());
    writeFileSync(path.join(root, "config/accounts.yaml"), "accounts:\n  - id: 1\n    email_env: ACCOUNT_EMAIL\n");
    writeFileSync(path.join(root, "config/concert.yaml"), concertYaml());
    process.env.ACCOUNT_EMAIL = "a@example.com";

    const { config, accounts } = loadAppConfig({ rootDir: root });

    expect(config.settings.base_url).toBe("https://www.thaiticketmajor.com");
    expect(config.settings.auto_login_on_startup).toBe(true);
    expect(config.concert.ticket_count).toBe(2);
    expect(accounts[0].email).toBe("a@example.com");
  });

  it("loads account reuse routing", () => {
    const root = path.join(tmpdir(), `ttm-config-reuse-${Date.now()}`);
    mkdirSync(path.join(root, "config"), { recursive: true });
    mkdirSync(path.join(root, "secrets"), { recursive: true });
    writeFileSync(path.join(root, "config/settings.yaml"), settingsYaml());
    writeFileSync(
      path.join(root, "config/accounts.yaml"),
      `
reuse_first_account: true
accounts:
  - id: 1
    email_env: ACCOUNT_EMAIL
`,
    );
    writeFileSync(path.join(root, "config/concert.yaml"), concertYaml());

    const { accountRouting } = loadAppConfig({ rootDir: root });

    expect(accountRouting.reuseFirstAccount).toBe(true);
  });

  it("fans out the first account to the requested bot count", () => {
    const accounts = [
      { id: 1, email_env: "ACCOUNT_EMAIL", email: "a@example.com" },
    ];

    const selected = selectBotAccounts(accounts, { botCount: 5, reuseFirstAccount: true });

    expect(selected).toHaveLength(5);
    expect(selected.map((account) => account.id)).toEqual([1, 2, 3, 4, 5]);
    expect(selected.map((account) => account.email_env)).toEqual([
      "ACCOUNT_EMAIL",
      "ACCOUNT_EMAIL",
      "ACCOUNT_EMAIL",
      "ACCOUNT_EMAIL",
      "ACCOUNT_EMAIL",
    ]);
    expect(selected.map((account) => account.email)).toEqual([
      "a@example.com",
      "a@example.com",
      "a@example.com",
      "a@example.com",
      "a@example.com",
    ]);
  });

  it("keeps existing one-account-per-bot selection by default", () => {
    const accounts = [
      { id: 1, email_env: "ACCOUNT_1_EMAIL" },
      { id: 2, email_env: "ACCOUNT_2_EMAIL" },
      { id: 3, email_env: "ACCOUNT_3_EMAIL" },
    ];

    const selected = selectBotAccounts(accounts, { botCount: 2, reuseFirstAccount: false });

    expect(selected.map((account) => account.id)).toEqual([1, 2]);
    expect(selected.map((account) => account.email_env)).toEqual(["ACCOUNT_1_EMAIL", "ACCOUNT_2_EMAIL"]);
  });

  it("loads queue-ready target round and observability config", () => {
    const root = path.join(tmpdir(), `ttm-config-queue-${Date.now()}`);
    mkdirSync(path.join(root, "config"), { recursive: true });
    mkdirSync(path.join(root, "secrets"), { recursive: true });
    writeFileSync(path.join(root, "config/settings.yaml"), settingsYaml());
    writeFileSync(path.join(root, "config/accounts.yaml"), "accounts:\n  - id: 1\n");
    writeFileSync(
      path.join(root, "config/concert.yaml"),
      `
event_url: https://www.thaiticketmajor.com/concert/example.html
event_date: "2026-08-21"
target_round:
  date: "2026-08-21"
  time: "18:00"
  type: offline
queue_start: "2026-06-28T09:00:00+07:00"
sale_start: "2026-06-28T10:00:00+07:00"
zone_priority: ["SC"]
ticket_count: 2
seat_strategy:
  prefer_rows: []
  avoid_rows: []
  prefer_center: false
selectors:
  buy_now_btn: "a.btn-buynow"
  zone_link: "a[href*='zone={zone}']"
queue_indicators:
  queue_url_pattern: "/queue"
  verify_url_pattern: "/verify.php"
  captcha_selector: ".captcha"
  puzzle_selector: ".puzzle"
observability:
  mode: forensic
  artifact_root: bot_data/runs
  capture_html: true
  capture_screenshot: true
  capture_network_failures: true
  capture_console_errors: true
  keep_runs: 10
`,
    );

    const { config } = loadAppConfig({ rootDir: root });

    expect(config.concert.target_round).toEqual({
      date: "2026-08-21",
      time: "18:00",
      type: "offline",
    });
    expect(config.concert.queue_start).toBe("2026-06-28T09:00:00+07:00");
    expect(config.concert.sale_start).toBe("2026-06-28T10:00:00+07:00");
    expect(config.concert.zone_priority).toEqual(["SC"]);
    expect(config.concert.observability).toEqual({
      mode: "forensic",
      artifact_root: "bot_data/runs",
      capture_html: true,
      capture_screenshot: true,
      capture_network_failures: true,
      capture_console_errors: true,
      keep_runs: 10,
    });
  });

  it("loads zone priority from a mock concert file by path", () => {
    const root = path.join(tmpdir(), `ttm-config-zone-priority-${Date.now()}`);
    mkdirSync(path.join(root, "config"), { recursive: true });
    mkdirSync(path.join(root, "secrets"), { recursive: true });
    writeFileSync(path.join(root, "config/settings.yaml"), settingsYaml());
    writeFileSync(path.join(root, "config/accounts.yaml"), "accounts:\n  - id: 1\n");
    writeFileSync(path.join(root, "config/mock-concert.yaml"), concertYaml(["MOCK_A", "MOCK_B", "MOCK_C"]));

    const { config } = loadAppConfig({
      rootDir: root,
      concertPath: "config/mock-concert.yaml",
    });

    expect(config.concert.zone_priority).toEqual(["MOCK_A", "MOCK_B", "MOCK_C"]);
  });

  it("loads the Rookie Divos concert file by path", () => {
    const { config } = loadAppConfig({
      concertPath: "config/concerts/rookie-divos.yaml",
    });

    expect(config.concert.event_url).toBe("https://www.thaiticketmajor.com/concert/rookie-divos-concert.html");
    expect(config.concert.event_date).toBe("2026-09-26");
    expect(config.concert.target_round).toEqual({
      date: "2026-09-26",
      time: "18:00",
      type: "offline",
    });
    expect(config.concert.queue_start).toBeUndefined();
    expect(config.concert.sale_start).toBe("2026-06-27T10:00:00+07:00");
    expect(config.concert.zone_priority.length).toBeGreaterThan(0);
    expect(config.concert.ticket_count).toBe(2);
  });

  it("loads the Pond Phuwin concert file by path", () => {
    const { config } = loadAppConfig({
      concertPath: "config/concerts/pond-phuwin-space-soul-dyssey.yaml",
    });

    expect(config.concert.event_url).toBe(
      "https://www.thaiticketmajor.com/concert/pond-phuwin-space-soul-dyssey-concert.html",
    );
    expect(config.concert.event_date).toBe("2026-08-21");
    expect(config.concert.target_round).toEqual({
      date: "2026-08-21",
      time: "18:00",
      type: "offline",
    });
    expect(config.concert.queue_start).toBe("2026-06-28T09:00:00+07:00");
    expect(config.concert.sale_start).toBe("2026-06-28T10:00:00+07:00");
    expect(config.concert.zone_priority.length).toBeGreaterThan(0);
    expect(config.concert.ticket_count).toBe(2);
  });
});

function settingsYaml(): string {
  return `
base_url: https://www.thaiticketmajor.com
headless: true
manual_solve_timeout: 10
debug: false
telegram:
  enabled: false
  token_env: TELEGRAM_TOKEN
  chat_id_env: TELEGRAM_CHAT_ID
`;
}

function concertYaml(zonePriority = ["A1"]): string {
  return `
event_url: https://www.thaiticketmajor.com/performance/example.html
event_date: "2026-12-15"
zone_priority: ${JSON.stringify(zonePriority)}
ticket_count: 2
seat_strategy:
  prefer_rows: []
  avoid_rows: []
  prefer_center: true
selectors:
  buy_now_btn: "a.btn-buynow"
  zone_link: "a[href*='zone={zone}']"
queue_indicators:
  queue_url_pattern: "/queue"
  verify_url_pattern: "/verify.php"
  captcha_selector: ".captcha"
  puzzle_selector: ".puzzle"
`;
}
