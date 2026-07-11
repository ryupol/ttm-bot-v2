const PRE_SALE_MIN_MS = 10_000;
const PRE_SALE_RANGE_MS = 5_000;
const POST_SALE_MIN_MS = 5_000;
const POST_SALE_RANGE_MS = 5_000;

export class QueueReloadScheduler {
  private readonly random: () => number;

  constructor(random: () => number = Math.random) {
    this.random = random;
  }

  botReloadOffsetMs(botId: number): number {
    return Math.max(0, botId - 1) * 150;
  }

  nextAcquisitionReloadDelayMs(now: Date, saleStartIso?: string, botId = 1): number {
    const saleStart = saleStartIso ? parseSaleStart(saleStartIso) : undefined;
    const afterSale = saleStart ? now.getTime() >= saleStart.getTime() : false;
    const min = afterSale ? POST_SALE_MIN_MS : PRE_SALE_MIN_MS;
    const range = afterSale ? POST_SALE_RANGE_MS : PRE_SALE_RANGE_MS;
    const jitter = Math.floor(this.random() * (range + 1));
    return min + jitter + this.botReloadOffsetMs(botId);
  }
}

const DEFAULT_QUEUE_RELOAD_SCHEDULER = new QueueReloadScheduler();

export function botReloadOffsetMs(botId: number): number {
  return DEFAULT_QUEUE_RELOAD_SCHEDULER.botReloadOffsetMs(botId);
}

export function nextAcquisitionReloadDelayMs(now: Date, saleStartIso?: string, botId = 1): number {
  return DEFAULT_QUEUE_RELOAD_SCHEDULER.nextAcquisitionReloadDelayMs(now, saleStartIso, botId);
}

function parseSaleStart(saleStartIso: string): Date {
  const saleStart = new Date(saleStartIso);
  if (Number.isNaN(saleStart.getTime())) throw new Error(`Invalid sale_start: ${saleStartIso}`);
  return saleStart;
}
