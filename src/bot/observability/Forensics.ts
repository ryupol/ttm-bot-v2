import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Page } from "playwright";
import type { TargetRound } from "../../config/schema.ts";

export type RunForensicsOptions = {
  artifactRoot: string;
  runId: string;
  botCount: number;
  targetRound?: TargetRound;
  queueStart?: string;
  saleStart?: string;
  captureHtml?: boolean;
  captureScreenshot?: boolean;
  captureNetworkFailures?: boolean;
  captureConsoleErrors?: boolean;
};

export type ForensicEvent = {
  botId?: number;
  state: string;
  url?: string;
  pageKind?: string;
  action: string;
  result: string;
  targetRound?: unknown;
  selector?: string;
  error?: string;
  stack?: string;
};

export type RunForensics = {
  runDir: string;
  captureNetworkFailures: boolean;
  captureConsoleErrors: boolean;
  event: (event: ForensicEvent) => void;
  botDir: (botId: number) => string;
  captureDecision: (botId: number, page: Page, label: string) => Promise<void>;
};

export function createRunForensics(options: RunForensicsOptions): RunForensics {
  if (!isValidRunId(options.runId)) {
    throw new Error(`Invalid runId: ${options.runId}`);
  }
  const captureHtml = options.captureHtml ?? true;
  const captureScreenshot = options.captureScreenshot ?? true;
  const captureNetworkFailures = options.captureNetworkFailures ?? true;
  const captureConsoleErrors = options.captureConsoleErrors ?? true;
  const runDir = path.join(options.artifactRoot, options.runId);
  mkdirSync(runDir, { recursive: true });
  writeFileSync(path.join(runDir, "run.json"), JSON.stringify(redactForArtifact(options), null, 2));
  const startedAt = Date.now();
  let sequence = 0;

  const botDir = (botId: number) => {
    const dir = path.join(runDir, `bot-${botId}`);
    mkdirSync(dir, { recursive: true });
    return dir;
  };

  return {
    runDir,
    captureNetworkFailures,
    captureConsoleErrors,
    botDir,
    event(event) {
      const payload = redactForArtifact({
        ts: new Date().toISOString(),
        elapsedMs: Date.now() - startedAt,
        ...event,
      });
      safeAppendJsonl(path.join(runDir, "events.jsonl"), payload);
    },
    async captureDecision(botId, page, label) {
      const dir = safeBotDir(botDir, botId);
      if (!dir) return;
      const prefix = `${String(++sequence).padStart(3, "0")}-${safeLabel(label)}`;
      if (captureScreenshot) {
        await page.screenshot({ path: path.join(dir, `${prefix}.png`), fullPage: true }).catch(() => undefined);
      }
      if (captureHtml) {
        const html = await page.content().catch(() => "");
        safeWriteFile(path.join(dir, `${prefix}.html`), redactHtml(html));
      }
    },
  };
}

export function attachForensicListeners(page: Page, run: RunForensics, botId: number): void {
  if (run.captureNetworkFailures) {
    page.on("requestfailed", (request) => {
      const dir = safeBotDir(run.botDir, botId);
      if (!dir) return;
      safeAppendJsonl(path.join(dir, "network.jsonl"), {
        ts: new Date().toISOString(),
        type: "requestfailed",
        url: request.url(),
        method: request.method(),
        failure: request.failure()?.errorText,
      });
    });
    page.on("response", (response) => {
      if (response.status() < 400) return;
      const dir = safeBotDir(run.botDir, botId);
      if (!dir) return;
      safeAppendJsonl(path.join(dir, "network.jsonl"), {
        ts: new Date().toISOString(),
        type: "response",
        url: response.url(),
        status: response.status(),
      });
    });
  }
  if (run.captureConsoleErrors) {
    page.on("pageerror", (error) => {
      const dir = safeBotDir(run.botDir, botId);
      if (!dir) return;
      safeAppendJsonl(path.join(dir, "console.jsonl"), {
        ts: new Date().toISOString(),
        type: "pageerror",
        message: error.message,
        stack: error.stack,
      });
    });
    page.on("console", (message) => {
      if (message.type() !== "error") return;
      const dir = safeBotDir(run.botDir, botId);
      if (!dir) return;
      safeAppendJsonl(path.join(dir, "console.jsonl"), {
        ts: new Date().toISOString(),
        type: message.type(),
        text: message.text(),
      });
    });
  }
}

export function redactForArtifact<T>(value: T): T {
  return JSON.parse(
    JSON.stringify(value, (key, val) => {
      if (isSensitiveKey(key)) return "[REDACTED]";
      if (typeof val === "string") return redactString(val);
      return val;
    }),
  ) as T;
}

function redactHtml(html: string): string {
  return redactString(html)
    .replace(/<[\w:-]+\b[^>]*>/gi, (tag) => {
      if (!isSensitiveElementTag(tag)) return tag;
      return redactHtmlAttribute(tag, "value");
    })
    .replace(/<textarea\b[^>]*>[\s\S]*?<\/textarea>/gi, (element) => {
      const openTag = /^<textarea\b[^>]*>/i.exec(element)?.[0] ?? "";
      if (!isSensitiveElementTag(openTag)) return element;
      return element.replace(/(<textarea\b[^>]*>)[\s\S]*?(<\/textarea>)/i, "$1[REDACTED]$2");
    })
    .replace(/<select\b[^>]*>[\s\S]*?<\/select>/gi, (element) => {
      const openTag = /^<select\b[^>]*>/i.exec(element)?.[0] ?? "";
      if (!isSensitiveElementTag(openTag)) return element;
      return element.replace(/(<select\b[^>]*>)[\s\S]*?(<\/select>)/i, "$1[REDACTED]$2");
    });
}

function safeLabel(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function isValidRunId(runId: string): boolean {
  return runId.length > 0 && !runId.includes("/") && !runId.includes("\\") && !runId.includes("..");
}

function safeBotDir(botDir: (botId: number) => string, botId: number): string | undefined {
  try {
    return botDir(botId);
  } catch {
    return undefined;
  }
}

function safeAppendJsonl(file: string, value: unknown): void {
  try {
    appendFileSync(file, `${JSON.stringify(redactForArtifact(value))}\n`);
  } catch {
    return;
  }
}

function safeWriteFile(file: string, data: string): void {
  try {
    writeFileSync(file, data);
  } catch {
    return;
  }
}

function isSensitiveKey(key: string): boolean {
  const normalized = normalizeKey(key);
  const exactAliases = new Set(["cc", "ccnumber", "ccnum", "pan", "exp"]);
  return (
    exactAliases.has(normalized) ||
    normalized.includes("token") ||
    normalized.includes("chatid") ||
    normalized.includes("password") ||
    normalized.includes("cookie") ||
    normalized.includes("authorization") ||
    normalized.includes("citizen") ||
    normalized.includes("email") ||
    normalized.includes("card") ||
    normalized.includes("creditcard") ||
    normalized.includes("securitycode") ||
    normalized.includes("expirationdate") ||
    normalized.includes("expiration") ||
    normalized.includes("cardholder") ||
    normalized.includes("expiry") ||
    normalized.includes("cvv") ||
    normalized.includes("cvc")
  );
}

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function redactString(value: string): string {
  return value
    .replace(/([?&#][^=&#\s"'<>]*(?:token|chat[_-]?id|chatid|password|cookie|authorization|citizen|email|card(?:number)?|creditcard|cc(?:number|num)?|securitycode|expiration(?:date)?|expiry|exp|cvv|cvc|pan)[^=&#\s"'<>]*=)[^&#\s"'<>]+/gi, "$1[REDACTED]")
    .replace(/\b((?:token|chat[_-]?id|chatid|password|cookie|authorization|citizen|email|card(?:number)?|creditcard|cc(?:number|num)?|securitycode|expiration(?:date)?|expiry|exp|cvv|cvc|pan)[A-Za-z0-9_-]*\s*=\s*)[^\s"'<>]+/gi, "$1[REDACTED]")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[REDACTED]")
    .replace(/\b\d{13}\b/g, "[REDACTED]");
}

function isSensitiveElementTag(tag: string): boolean {
  const type = getHtmlAttribute(tag, "type");
  if (type && normalizeKey(type) === "password") return true;
  return ["name", "id", "autocomplete"].some((attribute) => {
    const value = getHtmlAttribute(tag, attribute);
    return value ? isSensitiveKey(value) : false;
  });
}

function getHtmlAttribute(tag: string, attribute: string): string | undefined {
  const quoted = new RegExp(`\\b${attribute}\\s*=\\s*(["'])(.*?)\\1`, "i").exec(tag);
  if (quoted) return quoted[2];
  return new RegExp(`\\b${attribute}\\s*=\\s*([^\\s>]+)`, "i").exec(tag)?.[1];
}

function redactHtmlAttribute(tag: string, attribute: string): string {
  const quoted = new RegExp(`\\b(${attribute}\\s*=\\s*["'])[^"']*(["'])`, "i");
  if (quoted.test(tag)) {
    return tag.replace(new RegExp(`\\b(${attribute}\\s*=\\s*["'])[^"']*(["'])`, "gi"), "$1[REDACTED]$2");
  }
  if (new RegExp(`\\b${attribute}\\s*=`, "i").test(tag)) {
    return tag.replace(new RegExp(`\\b(${attribute}\\s*=\\s*)[^\\s>]+`, "gi"), "$1[REDACTED]");
  }
  return tag.replace(/>$/, ` ${attribute}="[REDACTED]">`);
}
