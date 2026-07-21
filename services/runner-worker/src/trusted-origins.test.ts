import { describe, expect, it } from "vitest";

import { parseTrustedOrigins } from "./trusted-origins.js";

describe("parseTrustedOrigins", () => {
  it("accepts explicit HTTP origins and rejects paths or credentials", () => {
    expect(parseTrustedOrigins("https://pricing.example.com,http://checkout:4173"))
      .toEqual(["https://pricing.example.com", "http://checkout:4173"]);
    expect(() => parseTrustedOrigins("https://user:secret@pricing.example.com"))
      .toThrow("must not include credentials");
    expect(() => parseTrustedOrigins("https://pricing.example.com/path"))
      .toThrow("must be origins");
  });
});
