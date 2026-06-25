import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadAppConfig } from "../src/config/load.js";

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
    expect(config.concert.ticket_count).toBe(2);
    expect(accounts[0].email).toBe("a@example.com");
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

function concertYaml(): string {
  return `
event_url: https://www.thaiticketmajor.com/performance/example.html
event_date: "2026-12-15"
zone_priority: ["A1"]
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
