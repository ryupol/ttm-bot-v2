import type { Page } from "playwright";
import type { TargetRound } from "../config/schema.ts";

export type TargetRoundState = {
  dataButton: string;
  dateText: string;
  timeText: string;
  type: "offline" | "live_streaming" | "rerun" | "any";
  disabled: boolean;
  soldOut: boolean;
  href: string;
  onclick: string;
  label: string;
  queueOrBookingCapable: boolean;
};

export async function resolveTargetRoundOnPage(page: Page, target: TargetRound): Promise<TargetRoundState | undefined> {
  return page.evaluate((targetRound) => {
    const classifyItem = (item: Element): "offline" | "live_streaming" | "rerun" => {
      const text = (item.textContent ?? "").toLowerCase();
      if (text.includes("rerun")) return "rerun";
      if (text.includes("live streaming") || text.includes("ttm live")) return "live_streaming";
      return "offline";
    };
    const rows = Array.from(document.querySelectorAll(".event-detail-item")).flatMap((item) => {
      const type = classifyItem(item);
      return Array.from(item.querySelectorAll(".box-event-list .row")).map((row) => ({ item, row, type }));
    });
    const matchesDate = (dateText: string, date: string) => {
      if (dateText.includes(date)) return true;
      const thaiDateText = new Intl.DateTimeFormat("th-TH-u-ca-buddhist", {
        day: "numeric",
        month: "long",
        year: "numeric",
        timeZone: "Asia/Bangkok",
      }).format(new Date(`${date}T00:00:00+07:00`));
      return dateText.includes(thaiDateText);
    };
    for (const { row, type } of rows) {
      if (targetRound.type !== "any" && type !== targetRound.type) continue;
      const dateText = row.querySelector(".date")?.textContent?.trim() ?? "";
      const button = row.querySelector<HTMLAnchorElement>("a.btn[data-button]");
      const timeText = button?.querySelector(".item-show")?.textContent?.trim() ?? "";
      if (!button || !matchesDate(dateText, targetRound.date) || timeText !== targetRound.time) continue;
      const href = button.getAttribute("href") ?? "";
      const onclick = button.getAttribute("onclick") ?? "";
      const label = button.textContent?.trim() ?? "";
      const disabled = button.hasAttribute("disabled");
      const roundStatusText = (row.textContent ?? "").toLowerCase();
      const soldOut =
        roundStatusText.includes("sold out") ||
        roundStatusText.includes("soldout") ||
        roundStatusText.includes("จำหน่ายหมด");
      const navEvidence = `${href} ${onclick} ${label}`.toLowerCase();
      return {
        dataButton: button.getAttribute("data-button") ?? "",
        dateText,
        timeText,
        type: targetRound.type === "any" ? type : targetRound.type,
        disabled,
        soldOut,
        href,
        onclick,
        label,
        queueOrBookingCapable:
          !disabled &&
          !soldOut &&
          (navEvidence.includes("queue") || navEvidence.includes("zones.php") || navEvidence.includes("booking")),
      };
    }
    return undefined;
  }, target);
}
