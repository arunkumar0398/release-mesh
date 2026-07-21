import { describe, expect, it } from "vitest";

import { createReleaseIdempotencyKey } from "./idempotency.js";

describe("release idempotency keys", () => {
  it("uses getRandomValues when randomUUID is unavailable", () => {
    const cryptoProvider = {
      getRandomValues: <T extends ArrayBufferView>(array: T): T => {
        if (array instanceof Uint8Array) array.set(Array.from({ length: 16 }, (_, index) => index));
        return array;
      }
    };

    expect(createReleaseIdempotencyKey("v2.1", cryptoProvider)).toMatch(
      /^release-v2-1-\d+-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    );
  });
});
