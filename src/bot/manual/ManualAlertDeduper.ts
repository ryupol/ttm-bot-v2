export type ManualAlertDeduper = {
  shouldEmit: (reason: string, url: string, now?: number) => boolean;
};

export function createManualAlertDeduper(options: { cooldownMs: number }): ManualAlertDeduper {
  let lastAlert: { key: string; at: number } | undefined;

  return {
    shouldEmit(reason, url, now = Date.now()) {
      const key = `${reason}:${normalizeManualUrl(url)}`;
      if (lastAlert?.key === key && now - lastAlert.at < options.cooldownMs) return false;
      lastAlert = { key, at: now };
      return true;
    },
  };
}

function normalizeManualUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.host}${parsed.pathname}`;
  } catch {
    return url;
  }
}
