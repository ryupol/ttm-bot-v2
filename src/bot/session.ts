export function hasLoggedInMarker(html: string): boolean {
  const normalized = html.toLowerCase();
  return normalized.includes("logout.php") ||
    normalized.includes("myticket.php") ||
    normalized.includes("/user/logout") ||
    normalized.includes("/user/myticket");
}
