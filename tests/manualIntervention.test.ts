import { describe, expect, it } from "vitest";
import {
  classifyManualIntervention,
  classifyUnknownManualPage,
  transitionManualIntervention,
} from "../src/bot/manual/ManualIntervention.ts";

describe("manualIntervention", () => {
  it("detects image captcha", () => {
    const result = classifyManualIntervention({
      url: "https://www.thaiticketmajor.com/8860/verify_2720_captcha",
      html: '<form action="/verify_2720_captcha"><img class="yz"></form>',
    });

    expect(result).toMatchObject({ present: true, reason: "captcha" });
    expect(result).toMatchObject({ userMessage: "Human check required" });
  });

  it("detects image captcha class variants", () => {
    expect(classifyManualIntervention({
      url: "https://www.thaiticketmajor.com/booking",
      html: "<form><img class='yz'></form>",
    })).toMatchObject({ present: true, reason: "captcha" });

    expect(classifyManualIntervention({
      url: "https://www.thaiticketmajor.com/booking",
      html: '<form><img class="foo yz bar"></form>',
    })).toMatchObject({ present: true, reason: "captcha" });

    expect(classifyManualIntervention({
      url: "https://www.thaiticketmajor.com/booking",
      html: '<form><img class = "yz"></form>',
    })).toMatchObject({ present: true, reason: "captcha" });
  });

  it("detects verify page", () => {
    const result = classifyManualIntervention({
      url: "https://booking.thaiticketmajor.com/booking/3m/verify.php",
      html: "<html></html>",
    });

    expect(result).toMatchObject({ present: true, reason: "verify" });
  });

  it("reports login page before embedded captcha", () => {
    const result = classifyManualIntervention({
      url: "https://event.thaiticketmajor.com/user/signin.php?query=557",
      html: '<script src="https://challenges.cloudflare.com/turnstile/v0/api.js"></script>',
    });

    expect(result).toEqual({
      present: true,
      reason: "login",
      detail: "login page with Turnstile",
      userMessage: "Login required",
    });
  });

  it("reports login page without human check", () => {
    const result = classifyManualIntervention({
      url: "https://event.thaiticketmajor.com/user/signin.php?query=557",
      html: "<form id='frm-signin-page'></form>",
    });

    expect(result).toEqual({
      present: true,
      reason: "login",
      detail: "login page",
      userMessage: "Login required",
    });
  });

  it("detects Gatekeeper CAPTCHA as manual CAPTCHA", () => {
    const result = classifyManualIntervention({
      url: "https://gatekeeper.thaiticketmajor.com/stacks/sep/?ks=redacted",
      html: `
        <main aria-label="CAPTCHA verification">
          <h1>Verify You Are Human</h1>
          <p>เพื่อความปลอดภัย กรุณาเรียงภาพให้ถูกต้อง</p>
          <p>Drag & drop the image pieces to assemble the complete picture.</p>
          <div draggable="true"></div>
          <button>ยืนยัน / Verify</button>
        </main>
      `,
    });

    expect(result).toMatchObject({ present: true, reason: "captcha" });
    expect(result).toMatchObject({ userMessage: "Human check required" });
  });

  it("reports 403 blocks", () => {
    const result = classifyManualIntervention({
      url: "https://booking.thaiticketmajor.com/403",
      html: "<h1>Access Denied</h1>",
    });

    expect(result).toEqual({
      present: true,
      reason: "forbidden",
      detail: "403",
      userMessage: "Access blocked: 403",
    });
  });

  it("reports 428 blocks", () => {
    const result = classifyManualIntervention({
      url: "https://booking.thaiticketmajor.com/428",
      html: "<h1>428 Precondition Required</h1>",
    });

    expect(result).toEqual({
      present: true,
      reason: "too_many_requests",
      detail: "428",
      userMessage: "Access blocked: 428",
    });
  });

  it("does not treat Queue-it visitor presence as CAPTCHA", () => {
    const result = classifyManualIntervention({
      url: "https://wait.thaiticketmajor.com/view/?c=ticketmasterasia",
      html: `
        <h2 id="h2ConfirmVisitorPresence">Still here?</h2>
        <p id="pConfirmVisitorPresence">Please confirm you're still waiting.</p>
        <button id="buttonConfirmVisitorPresence">Yes, I'm here</button>
      `,
    });

    expect(result).toEqual({ present: false });
  });

  it("ignores hidden recaptcha support iframe on event page", () => {
    const result = classifyManualIntervention({
      url: "https://www.thaiticketmajor.com/concert/rookie-divos-concert.html",
      html: `
        <main>
          <h1>ROOKIE DIVOS CONCERT</h1>
          <button data-button="123">Buy Now</button>
        </main>
        <iframe src="https://www.google.com/recaptcha/api2/aframe" width="0" height="0" style="display: none;"></iframe>
      `,
    });

    expect(result).toEqual({ present: false });
  });

  it("detects visible terms controls", () => {
    expect(classifyManualIntervention({
      url: "https://booking.thaiticketmajor.com/booking",
      html: '<button id="btn_confirmpolicy">Confirm</button>',
    })).toMatchObject({ present: true, reason: "terms" });
    expect(classifyManualIntervention({
      url: "https://booking.thaiticketmajor.com/booking",
      html: '<button id="btn_confirmpolicy">Confirm</button>',
    })).toMatchObject({ userMessage: "Terms confirmation required" });

    expect(classifyManualIntervention({
      url: "https://booking.thaiticketmajor.com/booking",
      html: '<input id="rdagree" type="checkbox">',
    })).toMatchObject({ present: true, reason: "terms" });
  });

  it("ignores hidden terms controls", () => {
    expect(classifyManualIntervention({
      url: "https://booking.thaiticketmajor.com/booking",
      html: '<button id="btn_confirmpolicy" hidden>Confirm</button>',
    })).toEqual({ present: false });

    expect(classifyManualIntervention({
      url: "https://booking.thaiticketmajor.com/booking",
      html: '<button id="btn_confirmpolicy" style="display:none">Confirm</button>',
    })).toEqual({ present: false });

    expect(classifyManualIntervention({
      url: "https://booking.thaiticketmajor.com/booking",
      html: '<button id="btn_confirmpolicy" style="visibility:hidden">Confirm</button>',
    })).toEqual({ present: false });

    expect(classifyManualIntervention({
      url: "https://booking.thaiticketmajor.com/booking",
      html: '<input name="rdagree" type="hidden">',
    })).toEqual({ present: false });

    expect(classifyManualIntervention({
      url: "https://booking.thaiticketmajor.com/booking",
      html: '<template><button id="btn_confirmpolicy">Confirm</button></template>',
    })).toEqual({ present: false });
  });

  it("classifies unknown manual pages", () => {
    expect(classifyUnknownManualPage({
      url: "https://booking.thaiticketmajor.com/unexpected",
      knownPage: false,
    })).toMatchObject({
      present: true,
      reason: "unknown_page",
      userMessage: "Stuck at booking.thaiticketmajor.com/unexpected",
    });

    expect(classifyUnknownManualPage({
      url: "https://booking.thaiticketmajor.com/booking",
      knownPage: true,
    })).toEqual({ present: false });
  });

  it("alerts only when visibility changes false to true", () => {
    expect(transitionManualIntervention(false, true)).toBe("appeared");
    expect(transitionManualIntervention(true, true)).toBe("unchanged");
    expect(transitionManualIntervention(true, false)).toBe("cleared");
    expect(transitionManualIntervention(false, false)).toBe("unchanged");
    expect([
      transitionManualIntervention(false, true),
      transitionManualIntervention(true, false),
      transitionManualIntervention(false, true),
    ]).toEqual(["appeared", "cleared", "appeared"]);
  });
});
