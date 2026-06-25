import { afterEach, describe, expect, it, vi } from "vitest";
import { Notifier } from "../src/bot/notifier.js";

describe("Notifier", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("does nothing when disabled", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const notifier = new Notifier({ enabled: false });
    await notifier.send("hello");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("sends Telegram message", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("ok", { status: 200 }));
    const notifier = new Notifier({ enabled: true, token: "token", chatId: "chat" });
    await notifier.send("hello");
    expect(fetchSpy).toHaveBeenCalledWith(
      "https://api.telegram.org/bottoken/sendMessage",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ chat_id: "chat", text: "hello" }),
      }),
    );
  });

  it("retries once then succeeds", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));
    const notifier = new Notifier({ enabled: true, token: "token", chatId: "chat" });
    await notifier.send("hello");
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });
});
