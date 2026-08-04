/** Cloudflare Worker entry point for Blum Agent. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";
import { FixedWindowRateLimiter } from "../src/security/rate-limit";
import { clientIdentity } from "../src/security/client-identity";

interface Env {
  ASSETS: Fetcher;
  IMAGES: {
    input(stream: ReadableStream): {
      transform(options: Record<string, unknown>): {
        output(options: { format: string; quality: number }): Promise<{ response(): Response }>;
      };
    };
  };
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

const SECURITY_HEADERS = {
  "X-DNS-Prefetch-Control": "on",
  "Strict-Transport-Security": "max-age=63072000; includeSubDomains; preload",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "SAMEORIGIN",
  "Referrer-Policy": "origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "Content-Security-Policy":
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; frame-ancestors 'none';",
} as const;

// This is deliberately separate from the application limiter. A Worker may
// dispatch into the app in the same isolate; sharing the instance would count
// every request twice and cut the advertised 30/minute budget in half.
const edgeChatRateLimiter = new FixedWindowRateLimiter({
  limit: 30,
  windowMs: 60_000,
  maxEntries: 10_000,
});

function staticCacheControl(pathname?: string): string | undefined {
  if (pathname === "/og.png" || pathname === "/favicon.svg") {
    // These public brand assets are versioned manually, so keep the browser
    // cache useful without making a future replacement impossible to roll out.
    return "public, max-age=604800, stale-while-revalidate=86400";
  }

  if (pathname === "/robots.txt" || pathname === "/sitemap.xml") {
    return "public, max-age=3600, stale-while-revalidate=300";
  }
}

function withSecurityHeaders(response: Response, pathname?: string): Response {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
    headers.set(key, value);
  }
  const cacheControl = staticCacheControl(pathname);
  if (cacheControl) headers.set("Cache-Control", cacheControl);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

// Image security config. SVG sources with .svg extension auto-skip the
// optimization endpoint on the client side (served directly, no proxy).
// To route SVGs through the optimizer (with security headers), set
// dangerouslyAllowSVG: true in next.config.js and uncomment below:
// const imageConfig: ImageConfig = { dangerouslyAllowSVG: true };

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if ((url.pathname === "/api/chat" || url.pathname === "/api/chat/stream") && request.method === "POST") {
      const identity = clientIdentity(request);
      if (identity !== "unknown") {
        const decision = edgeChatRateLimiter.attempt(identity);
        if (!decision.allowed) {
          return withSecurityHeaders(
            Response.json(
              {
                error: {
                  code: "rate_limited",
                  message: "请求较多，请稍后再试。",
                },
              },
              {
                status: 429,
                headers: {
                  "Cache-Control": "no-store, max-age=0",
                  "Retry-After": String(decision.retryAfterSeconds),
                },
              },
            ),
          );
        }
      }
    }

    if (url.pathname === "/_vinext/image") {
      const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
      const response = await handleImageOptimization(request, {
        fetchAsset: (path) => env.ASSETS.fetch(new Request(new URL(path, request.url))),
        transformImage: async (body, { width, format, quality }) => {
          const result = await env.IMAGES.input(body).transform(width > 0 ? { width } : {}).output({ format, quality });
          return result.response();
        },
      }, allowedWidths);
      return withSecurityHeaders(response);
    }

    return withSecurityHeaders(await handler.fetch(request, env, ctx), url.pathname);
  },
};

export default worker;
