export function hasLoggedInMarker(html: string): boolean {
  const normalized = html.toLowerCase();
  if (hasUnauthenticatedMemberMenuTemplate(normalized)) return false;

  return normalized.includes("logout.php") ||
    normalized.includes("myticket.php") ||
    normalized.includes("/user/logout") ||
    normalized.includes("/user/myticket");
}

function hasUnauthenticatedMemberMenuTemplate(normalizedHtml: string): boolean {
  const hasHeaderSignin = normalizedHtml.includes("btn-signin") ||
    normalizedHtml.includes("เข้าสู่ระบบ/สมัครสมาชิก");
  const hasEmptyMemberLinks = /\/user\/(?:myticket|history|editprofile|changepassword)\.php\?urid=(?:["'&#\s>]|$)/i
    .test(normalizedHtml);

  return hasHeaderSignin && hasEmptyMemberLinks;
}
