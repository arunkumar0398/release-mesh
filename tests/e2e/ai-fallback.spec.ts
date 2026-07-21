import { expect, test } from "@playwright/test";

import { createReleaseAndAwaitGate, openReleaseMesh } from "./helpers/release-flow.js";

test("no-key demo shows deterministic rule-based analysis without changing BLOCKED", async ({ page }) => {
  test.setTimeout(45_000);
  await openReleaseMesh(page);
  await createReleaseAndAwaitGate(page, "v2", "BLOCKED");

  const gate = page.getByRole("status", { name: "Deterministic release gate" });
  const risk = page.getByRole("region", { name: "Risk assessment" });
  await expect(gate).toContainText("BLOCKED");
  await expect(risk).toContainText("deterministic/rule-based fallback");
  await expect(risk).toContainText("Deterministic gate BLOCKED");
  await expect(risk).toContainText("deterministic gate remains the release authority");
  await expect(risk.getByRole("link", { name: /persisted evidence/i }).first()).toBeVisible();
});
