import type { Page } from "playwright";
import type { TargetRound } from "../../config/schema.ts";

type RoundType = "offline" | "live_streaming" | "rerun";

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

export type TargetRoundCandidate = {
  dataButton: string;
  dateText: string;
  timeText: string;
  type: RoundType;
  disabled: boolean;
  href: string;
  onclick: string;
  label: string;
  rowText: string;
};

export class TargetRoundResolver {
  async resolveOnPage(page: Page, target: TargetRound): Promise<TargetRoundState | undefined> {
    const candidates = await this.readCandidates(page);
    return this.matchTargetRound(candidates, target);
  }

  matchTargetRound(candidates: TargetRoundCandidate[], target: TargetRound): TargetRoundState | undefined {
    for (const candidate of candidates) {
      if (target.type !== "any" && candidate.type !== target.type) continue;
      if (!this.matchesDate(candidate.dateText, target.date) || candidate.timeText !== target.time) continue;
      return this.toTargetRoundState(candidate, target);
    }
    return undefined;
  }

  private async readCandidates(page: Page): Promise<TargetRoundCandidate[]> {
    return page.evaluate(() => {
      const classifyItem = (item: Element): "offline" | "live_streaming" | "rerun" => {
        const text = (item.textContent ?? "").toLowerCase();
        if (text.includes("rerun")) return "rerun";
        if (text.includes("live streaming") || text.includes("ttm live")) return "live_streaming";
        return "offline";
      };

      return Array.from(document.querySelectorAll(".event-detail-item")).flatMap((item) => {
        const type = classifyItem(item);
        return Array.from(item.querySelectorAll(".box-event-list .row")).flatMap((row) => {
          const button = row.querySelector<HTMLAnchorElement>("a.btn[data-button]");
          if (!button) return [];
          return {
            dataButton: button.getAttribute("data-button") ?? "",
            dateText: row.querySelector(".date")?.textContent?.trim() ?? "",
            timeText: button.querySelector(".item-show")?.textContent?.trim() ?? "",
            type,
            disabled: button.hasAttribute("disabled"),
            href: button.getAttribute("href") ?? "",
            onclick: button.getAttribute("onclick") ?? "",
            label: button.textContent?.trim() ?? "",
            rowText: row.textContent ?? "",
          };
        });
      });
    });
  }

  private matchesDate(dateText: string, date: string): boolean {
    if (dateText.includes(date)) return true;
    const thaiDateText = new Intl.DateTimeFormat("th-TH-u-ca-buddhist", {
      day: "numeric",
      month: "long",
      year: "numeric",
      timeZone: "Asia/Bangkok",
    }).format(new Date(`${date}T00:00:00+07:00`));
    return dateText.includes(thaiDateText);
  }

  private toTargetRoundState(candidate: TargetRoundCandidate, target: TargetRound): TargetRoundState {
    const roundStatusText = candidate.rowText.toLowerCase();
    const soldOut =
      roundStatusText.includes("sold out") ||
      roundStatusText.includes("soldout") ||
      roundStatusText.includes("จำหน่ายหมด");
    const navEvidence = `${candidate.href} ${candidate.onclick} ${candidate.label}`.toLowerCase();

    return {
      dataButton: candidate.dataButton,
      dateText: candidate.dateText,
      timeText: candidate.timeText,
      type: target.type === "any" ? candidate.type : target.type,
      disabled: candidate.disabled,
      soldOut,
      href: candidate.href,
      onclick: candidate.onclick,
      label: candidate.label,
      queueOrBookingCapable:
        !candidate.disabled &&
        !soldOut &&
        (navEvidence.includes("queue") || navEvidence.includes("zones.php") || navEvidence.includes("booking")),
    };
  }
}

const DEFAULT_TARGET_ROUND_RESOLVER = new TargetRoundResolver();

export async function resolveTargetRoundOnPage(page: Page, target: TargetRound): Promise<TargetRoundState | undefined> {
  return DEFAULT_TARGET_ROUND_RESOLVER.resolveOnPage(page, target);
}
