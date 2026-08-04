/**
 * Cloudflare sets this header after removing any client-supplied value.  Do
 * not use X-Forwarded-For here: it is attacker-controlled unless the full
 * proxy chain is explicitly trusted and configured by the deployment.
 */
export function clientIdentity(request: Request): string {
  const value = request.headers.get("cf-connecting-ip")?.trim();

  // Keep the limiter key bounded even when this module is exercised outside
  // Cloudflare (for example, in local tests or a misconfigured deployment).
  return value && value.length <= 64 ? value : "unknown";
}
