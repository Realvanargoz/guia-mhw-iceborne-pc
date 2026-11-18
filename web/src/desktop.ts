// Heartbeat for the desktop launcher (used in default-browser fallback mode). Errors are ignored.
// Edge throttles background pages, so also beat as soon as the page wakes up.
const INTERVAL_MS = 15_000;
let started = false;

function beat() {
  try {
    fetch("/api/app/heartbeat", { method: "POST", headers: { "X-MHW-Client": "1" }, keepalive: true }).catch(() => {});
  } catch {
    /* ignore */
  }
}

export function startHeartbeat(): void {
  if (started) return;
  started = true;
  beat();
  window.setInterval(beat, INTERVAL_MS);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") beat();
  });
  window.addEventListener("pageshow", beat);
  window.addEventListener("focus", beat);
  window.addEventListener("online", beat);
}
