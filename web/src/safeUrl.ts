/** Solo enlaces https:// (o http://) hacia fuera; cualquier otro esquema (javascript:, data:, file:) se descarta. */
export function safeHref(url?: string | null): string | undefined {
  if (!url) return undefined;
  try {
    const u = new URL(url);
    return u.protocol === "https:" || u.protocol === "http:" ? u.href : undefined;
  } catch {
    return undefined;
  }
}
