import type { Page } from "playwright";
import type { Concert } from "../../config/schema.js";
import type { PickedSeat } from "../../ipc/types.js";

export type FixedPageResult =
  | { status: "confirmed"; picks: PickedSeat[] }
  | { status: "no_seats" | "no_picks" | "no_confirm_btn" }
  | { status: "js_error"; error: string; stack?: string }
  | null;

export const PICK_AND_CLICK_SCRIPT = `
async (params) => {
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    const { want, strategy } = params;

    const available = Array.from(document.querySelectorAll("div[id^='checkseat-'].seatuncheck"));
    if (!available.length) return null;

    document.querySelectorAll("div[id^='checkseat-'].seatchecked").forEach(el => el.click());

    const seats = [];
    for (const el of available) {
        const parts = (el.getAttribute('data-seat') || '').split('-');
        if (parts.length >= 2 && /^\\d+$/.test(parts[1]))
            seats.push({ id: el.id, rowLabel: parts[0], col: parseInt(parts[1]) });
    }
    if (!seats.length) return { status: 'no_seats' };

    const rowLabels = [...new Set(seats.map(s => s.rowLabel))].sort();
    const labelToIdx = Object.fromEntries(rowLabels.map((lbl, i) => [lbl, i + 1]));
    const seatsIdx = seats.map(s => ({ ...s, row: labelToIdx[s.rowLabel] }));
    const totalCols = Math.max(...seatsIdx.map(s => s.col));
    const midCol = totalCols / 2.0;

    const avoidSet = new Set(strategy.avoid_rows || []);
    const filtered = seatsIdx.filter(s => !avoidSet.has(s.rowLabel) && !avoidSet.has(s.row));
    if (!filtered.length) return { status: 'no_seats' };

    const byRow = {};
    for (const s of filtered) (byRow[s.row] = byRow[s.row] || []).push(s);
    const allRows = Object.keys(byRow).map(Number).sort((a, b) => a - b);
    const midRow = (allRows[0] + allRows[allRows.length - 1]) / 2.0;

    const preferSet = new Set(strategy.prefer_rows || []);
    const priorityRows = allRows.filter(r => preferSet.has(r) || preferSet.has(rowLabels[r - 1]));
    const prioritySet = new Set(priorityRows);
    let extraRows = allRows.filter(r => !prioritySet.has(r));
    if (strategy.prefer_center !== false) extraRows.sort((a, b) => Math.abs(a - midRow) - Math.abs(b - midRow));
    const rowOrder = [...priorityRows, ...extraRows];
    const target = Math.min(want, filtered.length);

    function bestRun(rowSeats, count) {
        const sorted = [...rowSeats].sort((a, b) => a.col - b.col);
        let best = null, bestScore = Infinity;
        for (let i = 0; i <= sorted.length - count; i++) {
            let ok = true;
            for (let j = i; j < i + count - 1; j++) {
                if (sorted[j + 1].col - sorted[j].col !== 1) { ok = false; break; }
            }
            if (!ok) continue;
            const center = (sorted[i].col + sorted[i + count - 1].col) / 2.0;
            const score = Math.abs(center - midCol);
            if (score < bestScore) { bestScore = score; best = sorted.slice(i, i + count); }
        }
        return best;
    }

    let picks = null;
    for (const row of rowOrder) {
        picks = bestRun(byRow[row], target);
        if (picks) break;
    }

    if (!picks) {
        let seed = null;
        for (const row of rowOrder) {
            for (let cnt = target - 1; cnt >= 1; cnt--) {
                seed = bestRun(byRow[row], cnt);
                if (seed) break;
            }
            if (seed) break;
        }
        if (seed) {
            const pickedIds = new Set(seed.map(s => s.id));
            const seedCenterCol = (seed[0].col + seed[seed.length - 1].col) / 2.0;
            const seedRow = seed[0].row;
            const pool = filtered
                .filter(s => !pickedIds.has(s.id))
                .sort((a, b) => {
                    const da = Math.abs(a.row - seedRow) * 1000 + Math.abs(a.col - seedCenterCol);
                    const db = Math.abs(b.row - seedRow) * 1000 + Math.abs(b.col - seedCenterCol);
                    return da - db;
                });
            picks = [...seed];
            for (const s of pool) {
                if (picks.length >= target) break;
                picks.push(s);
            }
        } else {
            picks = filtered
                .sort((a, b) => Math.abs(a.col - midCol) - Math.abs(b.col - midCol))
                .slice(0, target);
        }
    }
    if (!picks || !picks.length) return { status: 'no_picks' };

    try {
        const jitter = (a, b) => a + Math.random() * (b - a);
        const fireClickSequence = async (el) => {
            if (!el) return false;
            const opts = { bubbles: true, cancelable: true, view: window, button: 0 };
            el.dispatchEvent(new MouseEvent('mousedown', opts));
            await sleep(jitter(10, 25));
            el.dispatchEvent(new MouseEvent('mouseup', opts));
            await sleep(jitter(5, 15));
            el.dispatchEvent(new MouseEvent('click', opts));
            return true;
        };

        for (const p of picks) {
            await fireClickSequence(document.getElementById(p.id));
            await sleep(jitter(20, 40));
        }
        window.__ttm_picked = picks.map(p => p.id);

        const btns = [
            document.querySelector('a#booknow'),
            document.querySelector('a#bookmnow'),
        ].filter(Boolean);
        if (!btns.length) return { status: 'no_confirm_btn' };
        const visible = btns.find(b => b.offsetParent !== null) || btns[0];
        await fireClickSequence(visible);
        window.__ttm_confirmed_at = Date.now();

        return {
            status: 'confirmed',
            picks: picks.map(p => ({ id: p.id, row: p.rowLabel, col: p.col })),
        };
    } catch (e) {
        return { status: 'js_error', error: e.message, stack: (e.stack || '').slice(0, 400) };
    }
}
`;

export async function selectSeatsOnFixedPage(page: Pick<Page, "url" | "evaluate" | "waitForTimeout">, concert: Concert): Promise<FixedPageResult> {
  if (!page.url().includes("fixed.php")) return null;

  const params = {
    want: concert.ticket_count,
    strategy: concert.seat_strategy,
  };

  let lastResult: FixedPageResult = null;
  for (let attempt = 1; attempt <= concert.seat_retry_limit; attempt += 1) {
    lastResult = await page.evaluate(PICK_AND_CLICK_SCRIPT, params) as FixedPageResult;
    if (lastResult?.status === "confirmed") return lastResult;
    if (lastResult?.status === "js_error" || lastResult?.status === "no_confirm_btn") return lastResult;
    await page.waitForTimeout(250);
  }
  return lastResult;
}
