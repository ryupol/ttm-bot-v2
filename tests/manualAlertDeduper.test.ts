import { describe, expect, it } from "vitest";
import { createManualAlertDeduper } from "../src/bot/manualAlertDeduper.ts";

describe("manualAlertDeduper", () => {
  it("suppresses same reason and page within cooldown", () => {
    const deduper = createManualAlertDeduper({ cooldownMs: 10_000 });
    const url = "https://gatekeeper.thaiticketmajor.com/stacks/sep/?ks=first";

    expect(deduper.shouldEmit("captcha", url, 1_000)).toBe(true);
    expect(deduper.shouldEmit("captcha", url, 1_500)).toBe(false);
    expect(deduper.shouldEmit("captcha", url, 11_001)).toBe(true);
  });

  it("allows different reasons and normalized pages", () => {
    const deduper = createManualAlertDeduper({ cooldownMs: 10_000 });

    expect(deduper.shouldEmit("captcha", "https://gatekeeper.thaiticketmajor.com/stacks/sep/?ks=first", 1_000)).toBe(true);
    expect(deduper.shouldEmit("verify", "https://gatekeeper.thaiticketmajor.com/stacks/sep/?ks=second", 1_500)).toBe(true);
    expect(deduper.shouldEmit("captcha", "https://gatekeeper.thaiticketmajor.com/verify.php", 2_000)).toBe(true);
  });
});
