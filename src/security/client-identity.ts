/**
 * Prefer Cloudflare's sanitized client address. For deployments behind a
 * conventional trusted reverse proxy, fall back to the left-most
 * X-Forwarded-For value, which represents the original client address.
 */
export function clientIdentity(request: Request): string {
  const cloudflareAddress = request.headers.get("cf-connecting-ip")?.trim();
  const forwardedAddress = request.headers
    .get("x-forwarded-for")
    ?.split(",", 1)[0]
    ?.trim();
  const value = cloudflareAddress || forwardedAddress;

  // Keep the limiter key bounded even when this module is exercised outside
  // Cloudflare (for example, in local tests or a misconfigured deployment).
  return value && value.length <= 64 ? value : "unknown";
}
