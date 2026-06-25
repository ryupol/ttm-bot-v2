export type NotifierConfig = {
  enabled: boolean;
  token?: string;
  chatId?: string;
};

export class Notifier {
  private readonly enabled: boolean;
  private readonly token?: string;
  private readonly chatId?: string;

  constructor(config: NotifierConfig) {
    this.enabled = config.enabled && Boolean(config.token && config.chatId);
    this.token = config.token;
    this.chatId = config.chatId;
  }

  async send(message: string): Promise<void> {
    if (!this.enabled) return;
    const url = `https://api.telegram.org/bot${this.token}/sendMessage`;
    const payload = { chat_id: this.chatId, text: message };
    let lastError: unknown;
    for (const attempt of [1, 2]) {
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(5000),
        });
        if (!res.ok) throw new Error(`Telegram HTTP ${res.status}`);
        return;
      } catch (error) {
        lastError = error;
        if (attempt === 1) await sleep(1000);
      }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }
}

export function createNotifierFromEnv(settings: {
  telegram: { enabled: boolean; token_env: string; chat_id_env: string };
}): Notifier {
  return new Notifier({
    enabled: settings.telegram.enabled,
    token: process.env[settings.telegram.token_env],
    chatId: process.env[settings.telegram.chat_id_env],
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
