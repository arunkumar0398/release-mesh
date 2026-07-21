import { expect, test } from "@playwright/test";

test("Shell resolves and displays the Release remote from runtime configuration", async ({ page }) => {
  let runtimeConfigRequested = false;
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  await page.route("**/remotes.json", async (route) => {
    runtimeConfigRequested = true;
    await route.fulfill({
      body: JSON.stringify({
        release: { manifestUrl: "http://127.0.0.1:4175/mf-manifest.json" }
      }),
      contentType: "application/json",
      status: 200
    });
  });

  await page.goto("http://127.0.0.1:4174");

  await expect(page.getByText("Release remote 0.1.0")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Pricing release assurance" })).toBeVisible();
  expect(runtimeConfigRequested).toBe(true);
  expect(consoleErrors).toEqual([]);
});
