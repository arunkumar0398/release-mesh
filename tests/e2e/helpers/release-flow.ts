import { expect, type Page } from "@playwright/test";

export type PricingCandidate = "v2" | "v2.1";
export type TerminalGate = "BLOCKED" | "ERROR" | "SAFE";

export async function openReleaseMesh(page: Page): Promise<void> {
  await page.goto("http://127.0.0.1:4174");
  await expect(page.getByRole("heading", { name: "ReleaseMesh" })).toBeVisible();
  await expect(page.getByText("Release remote 0.1.0")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Pricing release assurance" })).toBeVisible();
}

export async function createReleaseAndAwaitGate(
  page: Page,
  candidateVersion: PricingCandidate,
  expectedGate: TerminalGate
): Promise<string> {
  await page.getByRole("button", { exact: true, name: `Validate Pricing ${candidateVersion}` }).click();
  const gate = page.getByRole("status", { name: "Deterministic release gate" });
  await expect(gate).toContainText(expectedGate, { timeout: 30_000 });
  return page.getByText("Release ID").locator("..").locator("code").innerText();
}
