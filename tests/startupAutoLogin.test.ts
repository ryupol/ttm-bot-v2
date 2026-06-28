import { describe, expect, it, vi } from "vitest";
import { createStartupAutoLogin } from "../src/ipc/startupAutoLogin.ts";
import type { BotEvent } from "../src/ipc/types.ts";

describe("startup auto login", () => {
  it("sends login once when a bot first reaches idle", () => {
    const send = vi.fn();
    const autoLogin = createStartupAutoLogin({ enabled: true, send });
    const idleEvent: BotEvent = { type: "state", botId: 3, state: "IDLE", detail: "ready" };

    autoLogin.onBotEvent(idleEvent);
    autoLogin.onBotEvent(idleEvent);

    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(3, { type: "login" });
  });

  it("does not send login when disabled or non-idle", () => {
    const send = vi.fn();
    const autoLogin = createStartupAutoLogin({ enabled: false, send });

    autoLogin.onBotEvent({ type: "state", botId: 1, state: "IDLE" });
    autoLogin.onBotEvent({ type: "state", botId: 2, state: "READY" });

    expect(send).not.toHaveBeenCalled();
  });
});
