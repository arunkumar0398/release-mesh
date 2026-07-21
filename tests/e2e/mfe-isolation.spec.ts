import { expect, test } from "@playwright/test";

test("Shell loads Catalog and Release from independent remote manifests", async ({ page }) => {
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

  await page.goto("http://127.0.0.1:4174");

  await expect(page.getByText("Catalog remote 0.1.0")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("heading", { name: "Service Catalogue" })).toBeVisible();
  await expect(page.getByText("Release remote 0.1.0")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Pricing release assurance" })).toBeVisible();
  expect(browserFailures).toEqual([]);
});

test("Release remains usable when the Catalog manifest is unavailable", async ({ page }) => {
  await page.route("http://127.0.0.1:4176/mf-manifest.json", (route) => route.abort("failed"));

  await page.goto("http://127.0.0.1:4174");

  await expect(page.getByRole("alert")).toContainText("Catalog remote unavailable", {
    timeout: 15_000
  });
  await expect(page.getByText("Release remote 0.1.0")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Pricing release assurance" })).toBeVisible();
  await expect(page.getByRole("button", {
    exact: true,
    name: "Validate Pricing v2"
  })).toBeEnabled();
});
