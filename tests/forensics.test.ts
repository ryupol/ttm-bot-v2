import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Page } from "playwright";
import { describe, expect, it, vi } from "vitest";
import { attachForensicListeners, createRunForensics, redactForArtifact } from "../src/bot/forensics.ts";

describe("forensics", () => {
  it("creates run folder and writes JSONL events", () => {
    const root = mkdtempSync(path.join(tmpdir(), "ttm-forensics-"));
    const fx = createRunForensics({
      artifactRoot: root,
      runId: "2026-06-28T085900+0700",
      botCount: 5,
      targetRound: { date: "2026-08-21", time: "18:00", type: "offline" },
      queueStart: "2026-06-28T09:00:00+07:00",
      saleStart: "2026-06-28T10:00:00+07:00",
    });

    fx.event({ botId: 1, state: "READY", url: "https://example.test", pageKind: "event", action: "target_resolved", result: "ok" });

    const eventLines = readFileSync(path.join(root, "2026-06-28T085900+0700", "events.jsonl"), "utf8").trim().split("\n");
    expect(eventLines).toHaveLength(1);
    expect(JSON.parse(eventLines[0]).action).toBe("target_resolved");
  });

  it("redacts secrets and personal data", () => {
    const redacted = redactForArtifact({
      email: "a@example.com",
      citizenId: "1234567890123",
      headers: { cookie: "secret", authorization: "Bearer x" },
      nested: { password: "pw", TELEGRAM_TOKEN: "tok" },
    });

    expect(JSON.stringify(redacted)).not.toContain("a@example.com");
    expect(JSON.stringify(redacted)).not.toContain("1234567890123");
    expect(JSON.stringify(redacted)).not.toContain("Bearer x");
    expect(JSON.stringify(redacted)).not.toContain("secret");
    expect(JSON.stringify(redacted)).not.toContain("pw");
    expect(JSON.stringify(redacted)).not.toContain("tok");
  });

  it("redacts sensitive string contents and key variants", () => {
    const redacted = redactForArtifact({
      url: "https://example.test/path?token=abc&chat_id=12345&email=a@example.com&citizen=1234567890123#password=pw",
      text: "Authorization failed with Bearer secret-token for a@example.com and 1234567890123",
      chatId: "12345",
      "cc-number": "4111111111111111",
      securityCode: "123",
      expirationDate: "12/30",
    });
    const json = JSON.stringify(redacted);

    expect(json).not.toContain("abc");
    expect(json).not.toContain("12345");
    expect(json).not.toContain("a@example.com");
    expect(json).not.toContain("1234567890123");
    expect(json).not.toContain("secret-token");
    expect(json).not.toContain("pw");
    expect(json).not.toContain("4111111111111111");
    expect(json).not.toContain("12/30");
  });

  it("rejects run ids that can escape the artifact root", () => {
    const root = mkdtempSync(path.join(tmpdir(), "ttm-forensics-"));

    expect(() =>
      createRunForensics({
        artifactRoot: root,
        runId: "../escape",
        botCount: 1,
      }),
    ).toThrow("Invalid runId: ../escape");
  });

  it("captures redacted HTML using a safe label", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "ttm-forensics-"));
    const fx = createRunForensics({ artifactRoot: root, runId: "2026-06-28T085900+0700", botCount: 1 });
    const page = {
      async screenshot() {},
      async content() {
        return `
          <input type="password" value="pw">
          <input name="cardNumber" value="4111111111111111">
          <input value="123" name="cvv">
          <input name="cc-number" value="5555555555554444">
          <input name="securityCode" value="999">
          <input name="expirationDate" value="12/30">
          <input name="email" value="a@example.com">
          <custom-field name="cardNumber" value="6011111111111117"></custom-field>
          <textarea name="password">textarea-pw</textarea>
          <select name="cardType"><option>secret-card</option></select>
          <div>Bearer secret-token 1234567890123 token=abc</div>
        `;
      },
    } as unknown as Page;

    await fx.captureDecision(1, page, "Payment: Step 1!");

    const html = readFileSync(path.join(root, "2026-06-28T085900+0700", "bot-1", "001-payment-step-1.html"), "utf8");
    expect(html).not.toContain("pw");
    expect(html).not.toContain("4111111111111111");
    expect(html).not.toContain("5555555555554444");
    expect(html).not.toContain("6011111111111117");
    expect(html).not.toContain("123");
    expect(html).not.toContain("999");
    expect(html).not.toContain("12/30");
    expect(html).not.toContain("a@example.com");
    expect(html).not.toContain("textarea-pw");
    expect(html).not.toContain("secret-card");
    expect(html).not.toContain("secret-token");
    expect(html).not.toContain("1234567890123");
    expect(html).not.toContain("token=abc");
  });

  it("honors screenshot and HTML capture flags", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "ttm-forensics-"));
    const fx = createRunForensics({
      artifactRoot: root,
      runId: "2026-06-28T085900+0700",
      botCount: 1,
      captureHtml: false,
      captureScreenshot: false,
    });
    const page = {
      screenshot: vi.fn(async () => undefined),
      content: vi.fn(async () => '<input name="password" value="pw">'),
    } as unknown as Page;

    await fx.captureDecision(1, page, "payment");

    expect(page.screenshot).not.toHaveBeenCalled();
    expect(page.content).not.toHaveBeenCalled();
    expect(existsSync(path.join(root, "2026-06-28T085900+0700", "bot-1", "001-payment.png"))).toBe(false);
    expect(existsSync(path.join(root, "2026-06-28T085900+0700", "bot-1", "001-payment.html"))).toBe(false);
  });

  it("does not throw when event append fails after creation", () => {
    const root = mkdtempSync(path.join(tmpdir(), "ttm-forensics-"));
    const fx = createRunForensics({ artifactRoot: root, runId: "2026-06-28T085900+0700", botCount: 1 });
    rmSync(fx.runDir, { recursive: true, force: true });

    expect(() => fx.event({ state: "READY", action: "target_resolved", result: "ok" })).not.toThrow();
  });

  it("does not throw when captureDecision HTML write fails after bot dir creation", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "ttm-forensics-"));
    const fx = createRunForensics({ artifactRoot: root, runId: "2026-06-28T085900+0700", botCount: 1 });
    const botDir = fx.botDir(1);
    rmSync(botDir, { recursive: true, force: true });
    writeFileSync(botDir, "not-a-directory");
    const page = {
      async screenshot() {},
      async content() {
        return '<input name="password" value="pw">';
      },
    } as unknown as Page;

    await expect(fx.captureDecision(1, page, "payment")).resolves.toBeUndefined();
  });

  it("does not throw when forensic listener append fails", () => {
    const handlers: Record<string, (arg: unknown) => void> = {};
    const page = {
      on(event: string, cb: (arg: unknown) => void) {
        handlers[event] = cb;
      },
    } as unknown as Page;
    const run = {
      runDir: "/invalid",
      captureNetworkFailures: true,
      captureConsoleErrors: true,
      event() {},
      botDir() {
        throw new Error("no artifact path");
      },
      async captureDecision() {},
    };

    attachForensicListeners(page, run, 1);

    expect(() =>
      handlers.requestfailed?.({
        url: () => "https://example.test?token=abc",
        method: () => "GET",
        failure: () => ({ errorText: "Bearer secret-token" }),
      }),
    ).not.toThrow();
    expect(() =>
      handlers.console?.({
        type: () => "error",
        text: () => "Bearer secret-token",
      }),
    ).not.toThrow();
  });

  it("honors network and console listener flags", () => {
    const page = {
      on: vi.fn(),
    } as unknown as Page;
    const run = {
      runDir: "/invalid",
      captureNetworkFailures: false,
      captureConsoleErrors: false,
      event() {},
      botDir() {
        throw new Error("no artifact path");
      },
      async captureDecision() {},
    };

    attachForensicListeners(page, run, 1);

    expect(page.on).not.toHaveBeenCalled();
  });
});
