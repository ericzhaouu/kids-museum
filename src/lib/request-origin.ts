export function resolveRequestOrigin(request: Request) {
  const forwardedHost = request.headers
    .get("x-forwarded-host")
    ?.split(",")[0]
    ?.trim();
  const host = forwardedHost || request.headers.get("host")?.trim();
  const forwardedProtocol = request.headers
    .get("x-forwarded-proto")
    ?.split(",")[0]
    ?.trim();
  const fallback = new URL(request.url);
  if (host && /^[a-z0-9.-]+(?::\d+)?$/i.test(host)) {
    const protocol =
      forwardedProtocol === "https" || forwardedProtocol === "http"
        ? forwardedProtocol
        : fallback.protocol.replace(":", "");
    return `${protocol}://${host}`;
  }
  return fallback.origin;
}
