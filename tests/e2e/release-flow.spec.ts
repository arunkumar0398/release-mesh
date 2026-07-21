import { expect, test } from "@playwright/test";

test("Shell resolves and displays the Release remote from runtime configuration", async ({ page }) => {
  let runtimeConfigRequested = false;
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
  await page.route("**/remotes.json", async (route) => {
    runtimeConfigRequested = true;
    await route.fulfill({
      body: JSON.stringify({
        catalog: {
          apiBaseUrl: "/api",
          manifestUrl: "http://127.0.0.1:4176/mf-manifest.json"
        },
        release: {
          apiBaseUrl: "/api",
          manifestUrl: "http://127.0.0.1:4175/mf-manifest.json"
        }
      }),
      contentType: "application/json",
      status: 200
    });
  });

  await page.goto("http://127.0.0.1:4174");

  await expect(page.getByText("Release remote 0.1.0")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("heading", { name: "Pricing release assurance" })).toBeVisible();
  expect(runtimeConfigRequested).toBe(true);
  expect(browserFailures).toEqual([]);
});
