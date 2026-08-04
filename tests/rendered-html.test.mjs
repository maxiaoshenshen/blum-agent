import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

async function request(pathname = "/", init) {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request(`http://localhost${pathname}`, {
      headers: { accept: "text/html", ...init?.headers },
      ...init,
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server-renders the finished Chinese Blum Agent shell", async () => {
  const response = await request();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  assert.equal(response.headers.get("x-dns-prefetch-control"), "on");
  assert.equal(
    response.headers.get("strict-transport-security"),
    "max-age=63072000; includeSubDomains; preload",
  );
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("x-frame-options"), "SAMEORIGIN");
  assert.equal(
    response.headers.get("referrer-policy"),
    "origin-when-cross-origin",
  );
  assert.equal(
    response.headers.get("permissions-policy"),
    "camera=(), microphone=(), geolocation=()",
  );
  assert.equal(
    response.headers.get("content-security-policy"),
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; frame-ancestors 'none';",
  );

  const html = await response.text();
  assert.match(html, /<html[^>]*lang=["']zh-CN["']/i);
  assert.match(html, /<title>Blum Agent｜百隆五金智能工作台<\/title>/i);
  assert.match(html, /从一个问题开始/);
  assert.match(html, /百隆五金智能工作台/);
  assert.match(html, /官方资料优先/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape/i);
  assert.doesNotMatch(html, /react-loading-skeleton/);
});

test("serves the built chat API with a safe demo contract", async () => {
  const response = await request("/api/chat", {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      role: "consumer",
      messages: [{ role: "user", content: "BLUMOTION 是什么？" }],
    }),
  });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store, max-age=0");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(body.mode, "demo");
  assert.equal(body.sources[0].official, true);
  assert.match(body.sources[0].url, /^https:\/\//);
  assert.match(body.answer, /演示模式/);
});

test("rate-limits repeated chat requests at the Worker edge", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("rate-limit-test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  const environment = {
    ASSETS: {
      fetch: async () => new Response("Not found", { status: 404 }),
    },
  };
  const context = {
    waitUntil() {},
    passThroughOnException() {},
  };
  const makeRequest = () =>
    new Request("http://localhost/api/chat", {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        "cf-connecting-ip": "203.0.113.42",
      },
      body: JSON.stringify({
        role: "consumer",
        messages: [{ role: "user", content: "BLUMOTION 是什么？" }],
      }),
    });

  for (let index = 0; index < 30; index += 1) {
    const response = await worker.fetch(makeRequest(), environment, context);
    assert.equal(response.status, 200);
  }

  const limited = await worker.fetch(makeRequest(), environment, context);
  assert.equal(limited.status, 429);
  assert.match(limited.headers.get("retry-after") ?? "", /^\d+$/);
  assert.equal((await limited.json()).error.code, "rate_limited");
});

test("removes all disposable starter markers", async () => {
  const [layout, page, packageJson] = await Promise.all([
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);

  assert.match(layout, /lang="zh-CN"/);
  assert.match(layout, /Blum Agent｜百隆五金智能工作台/);
  assert.match(page, /<BlumAgent \/>/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
  await assert.rejects(
    access(new URL("../app/_sites-preview", import.meta.url)),
  );
});
