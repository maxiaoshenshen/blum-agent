const LOCAL_FALLBACK = new URL("http://localhost:3000");

export function publicSiteUrlFromEnvironment(
  environment: Record<string, string | undefined> = process.env,
): URL {
  const configured = environment.PUBLIC_SITE_URL?.trim();
  if (!configured) return new URL(LOCAL_FALLBACK);

  try {
    const url = new URL(configured);
    const isLocal =
      url.hostname === "localhost" ||
      url.hostname === "127.0.0.1" ||
      url.hostname === "[::1]";
    const allowedProtocol =
      url.protocol === "https:" || (url.protocol === "http:" && isLocal);

    if (!allowedProtocol || url.username || url.password) {
      return new URL(LOCAL_FALLBACK);
    }

    return new URL(url.origin);
  } catch {
    return new URL(LOCAL_FALLBACK);
  }
}
