import { expect, test } from "@playwright/test";

import { createReleaseAndAwaitGate, openReleaseMesh } from "./helpers/release-flow.js";

test("judge can inspect a BLOCKED Pricing v2 release and then create a SAFE v2.1 release", async ({ page }) => {
  test.setTimeout(60_000);
  const browserFailures: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") browserFailures.push(`console: ${message.text()}`);
  });
  page.on("pageerror", (error) => browserFailures.push(`pageerror: ${error.message}`));
  page.on("requestfailed", (request) => browserFailures.push(
    `requestfailed: ${request.method()} ${request.url()} ${request.failure()?.errorText ?? "unknown"}`
  ));
  page.on("response", (response) => {
    if (response.status() >= 400) browserFailures.push(`response: ${response.status()} ${response.url()}`);
  });

  await openReleaseMesh(page);
  const blockedReleaseId = await createReleaseAndAwaitGate(page, "v2", "BLOCKED");

  const lifecycle = page.getByRole("region", { name: "Release lifecycle" });
  await expect(lifecycle).toContainText("DRAFT");
  await expect(lifecycle).toContainText("TESTING");
  await expect(lifecycle).toContainText("BLOCKED");

  const testRuns = page.getByRole("region", { name: "Mandatory test runs" });
  await expect(testRuns).toContainText("contract-pricing");
  await expect(testRuns).toContainText("api-pricing");
  await expect(testRuns).toContainText("browser-checkout");

  const evidence = page.getByRole("region", { name: "Release evidence" });
  await expect(evidence).toContainText("CONTRACT_DIFF");
  await expect(evidence).toContainText("SANITIZED_LOG");
  await expect(evidence.getByRole("img", { name: "SCREENSHOT evidence" })).toBeVisible();

  const safeReleaseId = await createReleaseAndAwaitGate(page, "v2.1", "SAFE");
  await expect(page.getByText("Pricing v2.1", { exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "Mandatory test runs" })).toContainText("PASSED");
  expect(safeReleaseId).not.toBe(blockedReleaseId);
  expect(browserFailures).toEqual([]);
});
