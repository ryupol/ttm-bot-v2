import type { Page } from "playwright";
import type { Concert } from "../../config/schema.ts";
import type { PickedSeat } from "../../ipc/types.ts";

export type FixedPageResult =
  | { status: "confirmed"; picks: PickedSeat[] }
  | { status: "no_seats" | "no_picks" | "no_confirm_btn" }
  | { status: "js_error"; error: string; stack?: string }
  | null;

type BrowserSeatPickResult = FixedPageResult | { status: "selection_not_applied" };
type FixedPage = Pick<Page, "url" | "evaluate" | "waitForFunction" | "waitForTimeout">;

const pickAndClickSeatsInPage = async (params: {
  want: number;
  strategy: Concert["seat_strategy"];
}): Promise<BrowserSeatPickResult> => {
  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  const { want, strategy } = params;

  const available = Array.from(document.querySelectorAll<HTMLDivElement>("div[id^='checkseat-'].seatuncheck"));
  if (!available.length) return null;

  document.querySelectorAll<HTMLElement>("div[id^='checkseat-'].seatchecked").forEach((el) => el.click());

  const seats = [];
  for (const el of available) {
    const parts = (el.getAttribute("data-seat") || "").split("-");
    if (parts.length >= 2 && /^\d+$/.test(parts[1])) {
      seats.push({ id: el.id, rowLabel: parts[0], col: Number.parseInt(parts[1], 10) });
    }
  }
  if (!seats.length) return { status: "no_seats" };

  const rowLabels = [...new Set(seats.map((seat) => seat.rowLabel))].sort();
  const labelToIdx = Object.fromEntries(rowLabels.map((label, index) => [label, index + 1]));
  const seatsIdx = seats.map((seat) => ({ ...seat, row: labelToIdx[seat.rowLabel] }));
  const avoidSet = new Set(strategy.avoid_rows || []);
  const filtered = seatsIdx.filter((seat) => !avoidSet.has(seat.rowLabel) && !avoidSet.has(seat.row));
  if (!filtered.length) return { status: "no_seats" };

  const target = Math.min(want, filtered.length);
  const picks = filtered.slice(0, target);
  if (!picks.length) return { status: "no_picks" };

  try {
    const jitter = (a: number, b: number) => a + Math.random() * (b - a);
    const fireClickSequence = async (el: HTMLElement | null) => {
      if (!el) return false;
      const opts = { bubbles: true, cancelable: true, view: window, button: 0 };
      el.dispatchEvent(new MouseEvent("mousedown", opts));
      await sleep(jitter(10, 25));
      el.dispatchEvent(new MouseEvent("mouseup", opts));
      await sleep(jitter(5, 15));
      el.dispatchEvent(new MouseEvent("click", opts));
      return true;
    };

    for (const pick of picks) {
      const seat = document.getElementById(pick.id);
      await fireClickSequence(seat?.closest<HTMLElement>("td[data-info]") ?? seat);
      await sleep(jitter(60, 120));
    }

    await sleep(jitter(150, 250));
    const selectedCount = document.querySelectorAll("div[id^='checkseat-'].seatchecked").length;
    const paymentCount = Number.parseInt((document.querySelector<HTMLInputElement>("#payment_cnt")?.value ?? "0"), 10);
    if (selectedCount < target && paymentCount < target) return { status: "selection_not_applied" };

    const btns = [
      document.querySelector<HTMLElement>("a#booknow"),
      document.querySelector<HTMLElement>("a#bookmnow"),
    ].filter((button): button is HTMLElement => Boolean(button));
    if (!btns.length) return { status: "no_confirm_btn" };
    const visible = btns.find((button) => button.offsetParent !== null) || btns[0];
    await fireClickSequence(visible);
    await sleep(jitter(300, 500));

    const alertText = document.querySelector("#popup_alert #alertmessage")?.textContent?.trim() ?? "";
    const alertVisible = document.querySelector<HTMLElement>("#popup_alert")?.offsetParent !== null;
    const alertTextLower = alertText.toLowerCase();
    const isSelectionAlert = alertText.includes("กรุณาเลือกที่นั่ง") ||
      alertText.includes("ข้อมูลไม่ถูกต้อง") ||
      alertTextLower.includes("incorrect data") ||
      alertTextLower.includes("select number of seat");
    if (alertVisible && isSelectionAlert) {
      const closeMessage = (window as typeof window & { MessageClose?: () => void }).MessageClose;
      if (typeof closeMessage === "function") closeMessage();
      else document.querySelector<HTMLElement>("#popup_alert .btn-red")?.click();
      return { status: "selection_not_applied" };
    }

    return {
      status: "confirmed",
      picks: picks.map((pick) => ({ id: pick.id, row: pick.rowLabel, col: pick.col })),
    };
  } catch (error) {
    return {
      status: "js_error",
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? (error.stack || "").slice(0, 400) : undefined,
    };
  }
};

export async function selectSeatsOnFixedPage(
  page: FixedPage,
  concert: Concert,
): Promise<FixedPageResult> {
  return new FixedPageSeatSelector(concert).select(page);
}

export class FixedPageSeatSelector {
  private readonly concert: Concert;

  constructor(concert: Concert) {
    this.concert = concert;
  }

  async select(page: FixedPage): Promise<FixedPageResult> {
    if (!page.url().includes("fixed.php")) return null;

    const params = {
      want: this.concert.ticket_count,
      strategy: this.concert.seat_strategy,
    };

    let lastResult: BrowserSeatPickResult = null;
    for (let attempt = 1; attempt <= this.concert.seat_retry_limit; attempt += 1) {
      if (isBookingSecuredUrl(page.url())) return { status: "confirmed", picks: [] };
      if (!await waitForAvailableSeatDom(page)) {
        if (isBookingSecuredUrl(page.url())) return { status: "confirmed", picks: [] };
        return { status: "no_seats" };
      }
      try {
        lastResult = await page.evaluate(pickAndClickSeatsInPage, params) as BrowserSeatPickResult;
      } catch (error) {
        if (isBookingSecuredUrl(page.url()) || isNavigationDestroyedError(error)) {
          return { status: "confirmed", picks: [] };
        }
        throw error;
      }
      if (isBookingSecuredUrl(page.url())) {
        return lastResult?.status === "confirmed" ? lastResult : { status: "confirmed", picks: [] };
      }
      if (lastResult?.status === "confirmed") return lastResult;
      if (lastResult?.status === "js_error" || lastResult?.status === "no_confirm_btn") return lastResult;
      await page.waitForTimeout(250);
    }
    if (lastResult?.status === "selection_not_applied") {
      return { status: "no_picks" };
    }
    return lastResult;
  }
}

function isBookingSecuredUrl(url: string): boolean {
  return url.includes("paymentall.php") || url.includes("enroll.php");
}

function isNavigationDestroyedError(error: unknown): boolean {
  return error instanceof Error && error.message.includes("Execution context was destroyed");
}

async function waitForAvailableSeatDom(page: Pick<Page, "url" | "waitForFunction">): Promise<boolean> {
  try {
    await page.waitForFunction(
      () => document.querySelectorAll("div[id^='checkseat-'].seatuncheck").length > 0,
      undefined,
      { timeout: 15000, polling: 50 },
    );
    return true;
  } catch {
    return false;
  }
}
