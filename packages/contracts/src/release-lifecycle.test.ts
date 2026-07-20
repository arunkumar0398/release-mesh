import { describe, expect, it } from "vitest";

import { assertTransition, isValidTransition } from "./release-lifecycle.js";

describe("release lifecycle", () => {
  it("accepts the initial DRAFT transition", () => {
    expect(isValidTransition(null, "DRAFT")).toBe(true);
    expect(() => assertTransition(null, "DRAFT")).not.toThrow();
  });

  it("accepts the approved validation path", () => {
    expect(() => assertTransition("DRAFT", "VALIDATING")).not.toThrow();
    expect(() => assertTransition("VALIDATING", "QUEUED")).not.toThrow();
    expect(() => assertTransition("QUEUED", "TESTING")).not.toThrow();
    expect(() => assertTransition("TESTING", "ANALYZING")).not.toThrow();
    expect(() => assertTransition("ANALYZING", "SAFE")).not.toThrow();
  });

  it("permits explicit retries only from ERROR", () => {
    expect(isValidTransition("ERROR", "QUEUED")).toBe(true);
    expect(isValidTransition("BLOCKED", "QUEUED")).toBe(false);
  });

  it("rejects skipped and terminal-state transitions", () => {
    expect(() => assertTransition("DRAFT", "TESTING")).toThrow("Invalid release transition");
    expect(() => assertTransition("SAFE", "QUEUED")).toThrow("Invalid release transition");
  });
});
