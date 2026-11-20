// A lasting, private id for this browser. The leaderboard keeps one entry (your best) per id per board,
// so two people who share a name still get separate rows, but one player never fills a board.
const KEY = "lt.clientId.v1";
let cached: string | null = null;

export function getClientId(): string {
  if (cached) return cached;
  try {
    const existing = localStorage.getItem(KEY);
    if (existing && /^[A-Za-z0-9-]{8,64}$/.test(existing)) return (cached = existing);
  } catch {
    /* storage unavailable */
  }
  const id =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  try {
    localStorage.setItem(KEY, id);
  } catch {
    /* storage unavailable */
  }
  return (cached = id);
}
