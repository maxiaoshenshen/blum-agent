const startedAt = Date.now();

export async function GET(): Promise<Response> {
  const runtimeProcess = typeof process === "undefined" ? undefined : process;
  return Response.json({
    status: "healthy",
    timestamp: new Date().toISOString(),
    version: runtimeProcess?.env.npm_package_version ?? "0.1.0",
    uptime: runtimeProcess?.uptime?.() ?? (Date.now() - startedAt) / 1_000,
  }, {
    headers: {
      "Cache-Control": "no-store, max-age=0",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
