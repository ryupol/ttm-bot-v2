import type { Page } from "playwright";
import type { Concert } from "../../config/schema.ts";
import type { BotEvent, PickedSeat } from "../../ipc/types.ts";
import { waitForFixedPageNavigation, zoneFromUrl } from "../routing/PageFlowPolicy.ts";
import { classifyPage, type PageKind } from "../routing/PageClassifier.ts";
import { formatSeatsSelectedMessage } from "../observability/SeatAlert.ts";
import { selectSeatsOnFixedPage } from "./FixedPageSeatSelector.ts";
import { nextZoneAfter } from "./ZoneSelector.ts";

export type BookingForensics = {
  captureDecision: (label: string) => Promise<void>;
  event: (action: string, result: string, extra?: Record<string, unknown>) => void;
};

export type BookingServiceOptions = {
  botId: number;
  concert: Concert;
  emit: (event: BotEvent) => void;
  emitDone: (kind: PageKind) => void;
  notify: (message: string) => Promise<void>;
  handleCurrentPage: () => Promise<void>;
  shouldStop: () => boolean;
  forensics: BookingForensics;
};

export class BookingService {
  private readonly options: BookingServiceOptions;
  private zonesBaseUrl: string | undefined;
  private currentBookingZone: string | undefined;
  private readonly zonesTried = new Set<string>();

  constructor(options: BookingServiceOptions) {
    this.options = options;
  }

  async recoverFromErrorPage(p: Page): Promise<void> {
    await this.options.forensics.captureDecision("error-page");
    this.options.forensics.event("error-page", "recover", { zonesBaseUrl: this.zonesBaseUrl });
    if (this.zonesBaseUrl) {
      this.options.emit({ type: "log", botId: this.options.botId, message: "error page; returning to zones" });
      await p.goto(this.zonesBaseUrl, { waitUntil: "domcontentloaded" }).catch((error) => {
        this.options.emit({ type: "log", botId: this.options.botId, message: `error recovery failed: ${errorMessage(error)}` });
      });
      if (classifyPage(p.url()) === "zones") {
        await this.options.handleCurrentPage();
        return;
      }
    }
    this.options.emit({ type: "state", botId: this.options.botId, state: "AWAITING_USER", detail: "Error page" });
  }

  async bookSeats(p: Page): Promise<void> {
    while (!this.options.shouldStop()) {
      const zone = zoneFromUrl(p.url()) ?? this.currentBookingZone;

      this.options.emit({ type: "state", botId: this.options.botId, state: "BOOKING", detail: `Selecting seats${zone ? ` in ${zone}` : ""}` });
      await this.options.forensics.captureDecision("before-seat-selection");
      this.options.forensics.event("seat-selection", "start", { zone });
      const result = await selectSeatsOnFixedPage(p, this.options.concert);
      if (!result || result.status === "no_seats" || result.status === "no_picks") {
        await this.options.forensics.captureDecision("after-seat-selection");
        this.options.forensics.event("seat-selection", result?.status ?? "no-result", { zone });
        const securedKind = classifyPage(p.url());
        if (securedKind === "payment" || securedKind === "enroll") {
          this.options.forensics.event("booking", "secured-page-after-selection", { zone, pageKind: securedKind });
          this.options.emitDone(securedKind);
          return;
        }
        if (zone) this.zonesTried.add(zone);

        if (this.zonesBaseUrl) {
          await p.goto(this.zonesBaseUrl, { waitUntil: "domcontentloaded" }).catch((error) => {
            this.options.emit({ type: "log", botId: this.options.botId, message: `back to zones failed: ${errorMessage(error)}` });
          });
          if (classifyPage(p.url()) === "zones" && await this.enterNextZone(p)) {
            continue;
          }
        }

        const nextZone = nextZoneAfter(zone, this.options.concert.zone_priority, this.zonesTried);
        if (nextZone && await this.goToZone(p, nextZone)) {
          this.zonesTried.add(nextZone);
          this.currentBookingZone = nextZone;
          continue;
        }

        const message = `Bot ${this.options.botId}: Zone ${zone ?? "unknown"} - no seats available`;
        this.options.forensics.event("booking", "no-seats", { zone });
        this.options.emit({ type: "alert", botId: this.options.botId, kind: "no_seats", message, zone });
        await this.options.notify(message);
        this.options.emit({ type: "state", botId: this.options.botId, state: "AWAITING_USER", detail: "No seats" });
        return;
      }
      if (result.status !== "confirmed") {
        await this.options.forensics.captureDecision("after-seat-selection");
        this.options.forensics.event("seat-selection", result.status, { zone, error: "error" in result ? result.error : undefined });
        throw new Error(`Seat selection failed: ${result.status}${"error" in result ? ` ${result.error}` : ""}`);
      }

      const picks = result.picks.length > 0 ? result.picks : await this.readPaymentPageSeats(p);
      await this.options.forensics.captureDecision("after-seat-selection");
      this.options.forensics.event("seat-selection", "confirmed", { zone, picks: picks.length });
      const message = formatSeatsSelectedMessage(this.options.botId, zone, picks, this.options.concert.ticket_count);
      this.options.emit({ type: "alert", botId: this.options.botId, kind: "seats_selected", message, seats: picks, zone });
      await this.options.notify(message);
      this.options.forensics.event("booking", "done", { zone, picks: picks.length });
      const securedKind = classifyPage(p.url());
      if (securedKind === "payment" || securedKind === "enroll") this.options.emitDone(securedKind);
      else this.options.emit({ type: "state", botId: this.options.botId, state: "DONE", detail: "Seats confirmed" });
      return;
    }
  }

  async enterNextZone(p: Page): Promise<boolean> {
    this.zonesBaseUrl = p.url();
    const currentZone = zoneFromUrl(p.url());
    if (currentZone) this.zonesTried.add(currentZone);
    const nextZone = nextZoneAfter(currentZone, this.options.concert.zone_priority, this.zonesTried);
    if (!nextZone) {
      this.options.emit({ type: "state", botId: this.options.botId, state: "AWAITING_USER", detail: "Zone page; no zone_priority configured" });
      return false;
    }

    this.options.emit({ type: "state", botId: this.options.botId, state: "BOOKING", detail: `Selecting zone ${nextZone}` });
    await this.options.forensics.captureDecision("before-zone-selection");
    this.options.forensics.event("zone-selection", "start", { zone: nextZone });
    if (!await this.goToZone(p, nextZone)) {
      await this.options.forensics.captureDecision("after-zone-selection");
      this.options.forensics.event("zone-selection", "failed", { zone: nextZone });
      this.options.emit({ type: "state", botId: this.options.botId, state: "AWAITING_USER", detail: `Zone ${nextZone} not selectable` });
      return false;
    }
    this.currentBookingZone = nextZone;
    await this.options.forensics.captureDecision("after-zone-selection");
    this.options.forensics.event("zone-selection", "done", { zone: nextZone });
    await this.options.handleCurrentPage();
    return true;
  }

  private async readPaymentPageSeats(p: Page): Promise<PickedSeat[]> {
    if (classifyPage(p.url()) !== "payment") return [];
    return p.evaluate(() => {
      const seatText = document.querySelector('[data-selected="seat"]')?.textContent?.trim()
        || document.querySelector<HTMLInputElement>('input[name="seatlist"]')?.value
        || "";
      return seatText
        .split(",")
        .map((seat) => seat.trim().replace(/-P$/, ""))
        .filter(Boolean)
        .map((seat) => {
          const [row, col] = seat.split("-");
          return { id: `payment-${seat}`, row, col: Number.parseInt(col ?? "0", 10) };
        })
        .filter((seat) => seat.row && Number.isFinite(seat.col));
    }).catch(() => []);
  }

  private async goToZone(p: Page, zone: string): Promise<boolean> {
    this.options.emit({ type: "log", botId: this.options.botId, message: `no seats; trying next zone ${zone}` });
    this.options.emit({ type: "state", botId: this.options.botId, state: "BOOKING", detail: `Trying zone ${zone}` });

    if (classifyPage(p.url()) === "zones") {
      if (await this.clickZoneViaMap(p, zone)) return true;
    }

    const zoneUrl = replaceZoneInUrl(p.url(), zone);
    if (zoneUrl) {
      await p.goto(zoneUrl, { waitUntil: "domcontentloaded" });
      return true;
    }

    const selector = this.options.concert.selectors.zone_link.replace("{zone}", zone);
    try {
      await p.locator(selector).first().click({ timeout: 3000 });
      await p.waitForLoadState("domcontentloaded", { timeout: 10000 }).catch(() => undefined);
      return true;
    } catch (error) {
      this.options.emit({ type: "log", botId: this.options.botId, message: `zone ${zone} not clicked: ${errorMessage(error)}` });
      return false;
    }
  }

  private async clickZoneViaMap(p: Page, zone: string): Promise<boolean> {
    try {
      const clicked = await p.evaluate((zoneCode) => {
        const area = Array.from(document.querySelectorAll<HTMLAreaElement>(".map-zone area[href]"))
          .find((candidate) => candidate.href.endsWith(`#${zoneCode}`) || candidate.getAttribute("href")?.endsWith(`#${zoneCode}`));
        if (!area) return false;

        const event = new MouseEvent("click", { bubbles: true, cancelable: true, view: window, button: 0 });
        const selectZone = (window as typeof window & {
          selectzone?: (href: string, event: MouseEvent) => void;
        }).selectzone;
        if (typeof selectZone === "function") {
          selectZone(area.href, event);
          return true;
        }

        area.dispatchEvent(event);
        return true;
      }, zone);
      if (!clicked) return false;
      if (await waitForFixedPageNavigation(p, 18000)) return true;
      throw new Error("fixed page navigation not reached");
    } catch (error) {
      this.options.emit({ type: "log", botId: this.options.botId, message: `zone ${zone} map click failed: ${errorMessage(error)}` });
      return false;
    }
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function replaceZoneInUrl(url: string, zone: string): string | undefined {
  try {
    const parsed = new URL(url);
    if (!parsed.searchParams.has("zone")) return undefined;
    parsed.searchParams.set("zone", zone);
    return parsed.toString();
  } catch {
    return undefined;
  }
}
