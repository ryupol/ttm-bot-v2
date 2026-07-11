import { describe, expect, it, vi } from "vitest";
import { waitForManualInterventionToClear } from "../src/bot/manual/ManualRecovery.ts";

describe("manualRecovery", () => {
  it("waits until manual intervention disappears", async () => {
    const page = mockPage([
      {
        url: "https://gatekeeper.thaiticketmajor.com/verify_2720_captcha",
        html: '<form action="/verify_2720_captcha"><img class="yz"></form>',
      },
      {
        url: "https://gatekeeper.thaiticketmajor.com/verify_2720_captcha",
        html: '<form action="/verify_2720_captcha"><img class="yz"></form>',
      },
      {
        url: "https://www.thaiticketmajor.com/concert/fixed.php?zone=A1",
        html: "<html></html>",
      },
    ]);
    const onCleared = vi.fn();

    const result = await waitForManualInterventionToClear(page, {
      shouldStop: () => false,
      pollMs: 1,
      onCleared,
    });

    expect(result).toBe("cleared");
    expect(onCleared).toHaveBeenCalledTimes(1);
    expect(page.waitForTimeout).toHaveBeenCalledTimes(2);
  });

  it("stops waiting when requested", async () => {
    const page = mockPage([{
      url: "https://gatekeeper.thaiticketmajor.com/verify_2720_captcha",
      html: '<form action="/verify_2720_captcha"><img class="yz"></form>',
    }]);
    const result = await waitForManualInterventionToClear(page, {
      shouldStop: () => true,
      pollMs: 1,
    });

    expect(result).toBe("stopped");
  });
});

function mockPage(sequence: Array<{ url: string; html: string }>) {
  let contentCalls = 0;
  return {
    url: () => sequence[Math.min(contentCalls, sequence.length - 1)].url,
    content: vi.fn(async () => sequence[Math.min(contentCalls++, sequence.length - 1)].html),
    waitForTimeout: vi.fn(async () => undefined),
  };
}
