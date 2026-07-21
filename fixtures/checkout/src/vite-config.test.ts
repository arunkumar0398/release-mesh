// @vitest-environment node

import { describe, expect, it } from "vitest";

import config from "../vite.config.js";

describe("Checkout Vite server", () => {
  it("allows only the trusted Compose hostname in addition to Vite defaults", () => {
    expect(config.server?.allowedHosts).toEqual(["checkout"]);
  });
});
