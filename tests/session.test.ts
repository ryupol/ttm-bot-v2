import { describe, expect, it } from "vitest";
import { hasLoggedInMarker } from "../src/bot/auth/SessionMarkers.ts";

describe("session", () => {
  it("detects logged-in menu markers", () => {
    expect(hasLoggedInMarker('<a href="/user/myticket.php">My Ticket</a>')).toBe(true);
    expect(hasLoggedInMarker('<a href="/user/logout.php">Logout</a>')).toBe(true);
  });

  it("does not treat hidden mobile signin menu as logged in", () => {
    expect(hasLoggedInMarker(`
      <nav class="main-nav">
        <ul class="menu">
          <li class="mn-item d-block d-lg-none">
            <a href="javascript:void(0);" onclick="$app.popup.signin();">
              <span class="txt">เข้าสู่ระบบ/สมัครสมาชิก</span>
            </a>
          </li>
          <li><a href="/all-event/">ทุกงานแสดง</a></li>
        </ul>
      </nav>
    `)).toBe(false);
  });

  it("does not treat unauthenticated event page member menu template as logged in", () => {
    expect(hasLoggedInMarker(`
      <button class="btn-signin item d-none d-lg-inline-block"
        onclick="window.location='https://event.thaiticketmajor.com/user/signin.php?redir=/concert/rookie-divos-concert.html'">
        เข้าสู่ระบบ
      </button>
      <div style="display:none;">
        <div class="popup" id="popup-member-menu">
          <a class="item" href="/user/myticket.php?urId=">ตั๋วของฉัน</a>
          <a class="item" href="/user/logout.php">ออกจากระบบ</a>
        </div>
      </div>
    `)).toBe(false);
  });

  it("detects account markers even when signin controls are present", () => {
    expect(hasLoggedInMarker(`
      <a href="javascript:void(0);" onclick="$app.popup.signin();">Sign in</a>
      <a href="/user/myticket.php">My Ticket</a>
    `)).toBe(true);
  });

  it("treats account markers as logged in even when hidden signin controls exist", () => {
    expect(hasLoggedInMarker(`
      <nav style="display:none">
        <a href="javascript:void(0);" onclick="$app.popup.signin();">Sign in</a>
      </nav>
      <a href="/user/myticket.php">My Ticket</a>
      <a href="/user/logout.php">Logout</a>
    `)).toBe(true);
  });
});
