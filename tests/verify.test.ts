import { describe, expect, it, vi } from "vitest";
import { submitThaiCitizenId, submitVerifyCondition } from "../src/bot/pages/verify.ts";
import type { ResolvedAccount } from "../src/config/schema.ts";

describe("submitThaiCitizenId", () => {
  it("skips non verify page", async () => {
    const page = mockVerifyPage("https://booking.thaiticketmajor.com/booking/zones.php");

    await expect(submitThaiCitizenId(page as never, account("1234567890123"))).resolves.toEqual({ status: "not_verify_page" });
  });

  it("requires citizen ID", async () => {
    const page = mockVerifyPage("https://booking.thaiticketmajor.com/booking/verify.php");

    await expect(submitThaiCitizenId(page as never, account(undefined))).resolves.toEqual({ status: "missing_citizen_id" });
    expect(page.locator).not.toHaveBeenCalled();
  });

  it("clicks Thai ID method, fills same citizen ID, and submits", async () => {
    let currentUrl = "https://booking.thaiticketmajor.com/booking/verify.php";
    const page = mockVerifyPage(currentUrl, () => {
      currentUrl = "https://booking.thaiticketmajor.com/booking/zones.php";
    });
    page.url.mockImplementation(() => currentUrl);

    await expect(submitThaiCitizenId(page as never, account("1234567890123"))).resolves.toEqual({ status: "passed" });

    expect(page.locator).toHaveBeenCalledWith("button.verify-method-btn[data-method='thaiid']");
    expect(page.locator).toHaveBeenCalledWith("input#txt_verifycode");
    expect(page.locator).toHaveBeenCalledWith("button#btnconfirm");
    expect(page.input.fill).toHaveBeenNthCalledWith(1, "");
    expect(page.input.fill).toHaveBeenNthCalledWith(2, "1234567890123");
  });

  it("retries with same citizen ID when still on verify page", async () => {
    const page = mockVerifyPage("https://booking.thaiticketmajor.com/booking/verify.php");

    await expect(submitThaiCitizenId(page as never, account("1234567890123"), 2)).resolves.toMatchObject({ status: "failed" });
    expect(page.input.fill).toHaveBeenCalledWith("1234567890123");
    expect(page.input.fill).toHaveBeenCalledTimes(4);
  });
});

describe("submitVerifyCondition", () => {
  it("skips non verify condition page", async () => {
    const page = mockVerifyConditionPage("https://booking.thaiticketmajor.com/booking/zones.php");

    await expect(submitVerifyCondition(page as never)).resolves.toEqual({ status: "not_verify_condition_page" });
  });

  it("ticks terms and clicks confirm", async () => {
    const page = mockVerifyConditionPage("https://booking.thaiticketmajor.com/booking/verify_condition.php");

    await expect(submitVerifyCondition(page as never)).resolves.toEqual({ status: "submitted" });

    expect(page.evaluate).toHaveBeenCalledTimes(1);
    expect(page.locator).toHaveBeenCalledWith(expect.stringContaining("button#btn_verify"));
    expect(page.confirm.click).toHaveBeenCalledWith({ timeout: 5000 });
  });

  it("returns confirm_not_found when no visible confirm button", async () => {
    const page = mockVerifyConditionPage("https://booking.thaiticketmajor.com/booking/verify_condition.php", false);

    await expect(submitVerifyCondition(page as never)).resolves.toEqual({ status: "confirm_not_found" });
    expect(page.confirm.click).not.toHaveBeenCalled();
  });
});

function account(citizenId: string | undefined): ResolvedAccount {
  return { id: 1, citizenId };
}

function mockVerifyPage(initialUrl: string, afterConfirm?: () => void) {
  const method = { click: vi.fn().mockResolvedValue(undefined) };
  const input = {
    waitFor: vi.fn().mockResolvedValue(undefined),
    fill: vi.fn().mockResolvedValue(undefined),
  };
  const confirm = {
    click: vi.fn().mockImplementation(async () => afterConfirm?.()),
  };
  const page = {
    method,
    input,
    confirm,
    url: vi.fn(() => initialUrl),
    waitForURL: vi.fn().mockResolvedValue(undefined),
    waitForLoadState: vi.fn().mockResolvedValue(undefined),
    locator: vi.fn((selector: string) => {
      const target = selector.includes("verify-method-btn") ? method : selector.includes("txt_verifycode") ? input : confirm;
      return { first: () => target };
    }),
  };
  return page;
}

function mockVerifyConditionPage(initialUrl: string, confirmVisible = true) {
  const confirm = {
    isVisible: vi.fn().mockResolvedValue(confirmVisible),
    click: vi.fn().mockResolvedValue(undefined),
  };
  const page = {
    confirm,
    url: vi.fn(() => initialUrl),
    evaluate: vi.fn().mockResolvedValue(undefined),
    waitForURL: vi.fn().mockResolvedValue(undefined),
    waitForLoadState: vi.fn().mockResolvedValue(undefined),
    locator: vi.fn(() => ({ first: () => confirm })),
  };
  return page;
}
