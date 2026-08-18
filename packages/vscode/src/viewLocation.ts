const SECONDARY_SIDEBAR_VERSION = 106;

export function supportsSecondarySidebar(version: string): boolean {
  const match = /^(\d+)\.(\d+)/.exec(version);
  if (!match) return false;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  return major > 1 || (major === 1 && minor >= SECONDARY_SIDEBAR_VERSION);
}

export function chatViewContainer(version: string): {
  container: "hackl" | "hackl.activitybar";
  view: "hackl.chatView" | "hackl.chatActivitybar";
} {
  return supportsSecondarySidebar(version)
    ? { container: "hackl", view: "hackl.chatView" }
    : { container: "hackl.activitybar", view: "hackl.chatActivitybar" };
}
