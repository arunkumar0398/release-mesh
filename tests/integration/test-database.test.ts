import { describe, expect, it } from "vitest";

import { assertTestDatabaseUrl } from "./test-database.js";

describe("assertTestDatabaseUrl", () => {
  it("rejects the demo database and accepts an isolated test database", () => {
    expect(() => assertTestDatabaseUrl("postgresql://user:pass@localhost:5433/releasemesh"))
      .toThrow("must end with _test");
    expect(assertTestDatabaseUrl("postgresql://user:pass@localhost:5433/releasemesh_test"))
      .toBe("postgresql://user:pass@localhost:5433/releasemesh_test");
  });
});
