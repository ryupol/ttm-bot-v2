import type { BrowserContext } from "playwright";
import type { Settings } from "../config/schema.ts";

export type Tile = {
  left: number;
  top: number;
  width: number;
  height: number;
};

export function computeTile(index: number, total: number, windowSettings: Settings["window"]): Tile {
  const cols = Math.ceil(Math.sqrt(total));
  const rows = Math.ceil(total / cols);
  const gap = windowSettings.gap;
  const width = Math.floor((windowSettings.screen_width - gap * (cols + 1)) / cols);
  const height = Math.floor((windowSettings.screen_height - gap * (rows + 1)) / rows);
  const col = index % cols;
  const row = Math.floor(index / cols);
  return {
    left: gap + col * (width + gap),
    top: gap + row * (height + gap),
    width,
    height,
  };
}

export async function tileBrowserWindow(
  context: BrowserContext,
  index: number,
  total: number,
  settings: Settings,
): Promise<void> {
  const [page] = context.pages();
  if (!page) return;
  const session = await context.newCDPSession(page);
  const target = await session.send("Browser.getWindowForTarget");
  const tile = computeTile(index, total, settings.window);
  await session.send("Browser.setWindowBounds", {
    windowId: target.windowId,
    bounds: tile,
  });
}
