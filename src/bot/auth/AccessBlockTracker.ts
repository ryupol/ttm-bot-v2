import type { BotEvent } from "../../ipc/types.ts";

export type AccessBlockResponse = {
  status: () => number;
  url: () => string;
  request: () => { resourceType: () => string };
};

export type AccessBlockTrackerOptions = {
  botId: number;
  emit: (event: BotEvent) => void;
};

type AccessBlock = {
  code: 403 | 428;
  url: string;
  at: number;
};

export class AccessBlockTracker {
  private lastAccessBlock: AccessBlock | undefined;
  private readonly options: AccessBlockTrackerOptions;
  private suppressAccessBlockUntil = 0;

  constructor(options: AccessBlockTrackerOptions) {
    this.options = options;
  }

  handleResponse(response: AccessBlockResponse): void {
    const status = response.status();
    if (status !== 403 && status !== 428) return;
    if (!isRelevantAccessBlockResponse(response.url(), response.request().resourceType())) return;
    if (Date.now() < this.suppressAccessBlockUntil) {
      this.options.emit({ type: "log", botId: this.options.botId, message: `ignored access block after confirmed login: ${status}` });
      return;
    }

    this.lastAccessBlock = { code: status, url: response.url(), at: Date.now() };
    this.emitAccessBlock(status);
  }

  emitRecent(maxAgeMs = 120_000): boolean {
    if (Date.now() < this.suppressAccessBlockUntil) return false;
    if (!this.lastAccessBlock) return false;
    if (Date.now() - this.lastAccessBlock.at > maxAgeMs) return false;
    this.emitAccessBlock(this.lastAccessBlock.code);
    return true;
  }

  clearAfterSuccessfulLogin(): void {
    this.lastAccessBlock = undefined;
    this.suppressAccessBlockUntil = Date.now() + 10_000;
  }

  private emitAccessBlock(code: 403 | 428): void {
    this.options.emit({ type: "state", botId: this.options.botId, state: "MANUAL_INTERVENTION", detail: `Access blocked: ${code}` });
    this.options.emit({ type: "log", botId: this.options.botId, message: `access blocked: ${code}` });
  }
}

function isRelevantAccessBlockResponse(url: string, resourceType: string): boolean {
  if (resourceType !== "document" && resourceType !== "xhr" && resourceType !== "fetch") return false;
  try {
    const host = new URL(url).host.toLowerCase();
    return host.endsWith("thaiticketmajor.com") || host.endsWith("ticketmaster.co.th") || host.endsWith("gatekeeper.thaiticketmajor.com");
  } catch {
    return false;
  }
}
