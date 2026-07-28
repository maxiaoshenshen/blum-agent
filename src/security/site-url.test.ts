import { describe, expect, it } from "vitest";
import { publicSiteUrlFromEnvironment } from "./site-url";

describe("publicSiteUrlFromEnvironment", () => {
  it("uses a configured HTTPS origin without credentials or paths", () => {
    expect(
      publicSiteUrlFromEnvironment({
        PUBLIC_SITE_URL: "https://blum-agent.example.com/path?ignored=yes",
      }).href,
    ).toBe("https://blum-agent.example.com/");
  });

  it("rejects untrusted protocols, credentials, and malformed values", () => {
    for (const value of [
      "javascript:alert(1)",
      "https://user:pass@example.com",
      "not a URL",
    ]) {
      expect(
        publicSiteUrlFromEnvironment({ PUBLIC_SITE_URL: value }).href,
      ).toBe("http://localhost:3000/");
    }
  });

  it("allows HTTP only for local development", () => {
    expect(
      publicSiteUrlFromEnvironment({
        PUBLIC_SITE_URL: "http://localhost:4173",
      }).href,
    ).toBe("http://localhost:4173/");
    expect(
      publicSiteUrlFromEnvironment({
        PUBLIC_SITE_URL: "http://blum-agent.example.com",
      }).href,
    ).toBe("http://localhost:3000/");
  });
});
