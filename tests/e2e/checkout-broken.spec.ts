import type { Server } from "node:http";
import { stat } from "node:fs/promises";

import { expect, test } from "@playwright/test";

import { createPricingServer } from "../../fixtures/pricing/src/server.js";

let pricingServer: Server | undefined;

async function startPricing(mode: "v2" | "v2.1"): Promise<void> {
  pricingServer = createPricingServer({ mode });
  await new Promise<void>((resolve) => pricingServer?.listen(4100, "127.0.0.1", resolve));
}

test.afterEach(async () => {
  if (pricingServer) {
    const server = pricingServer;
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    pricingServer = undefined;
  }
});

test("Pricing v2 captures the broken Checkout experience", async ({ page }, testInfo) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  await startPricing("v2");

  await page.goto("/");

  await expect(page.locator('link[rel~="icon"]')).toHaveAttribute("href", /.+/);
  await expect(page.getByRole("alert")).toContainText("Checkout unavailable");
  await expect(page.getByRole("alert")).toContainText(
    "Pricing response is incompatible: missing price, currency"
  );
  const screenshotPath = testInfo.outputPath("checkout-v2-blocked.png");
  await page.screenshot({ fullPage: true, path: screenshotPath });
  expect((await stat(screenshotPath)).size).toBeGreaterThan(0);
  await testInfo.attach("checkout-v2-blocked", {
    path: screenshotPath,
    contentType: "image/png"
  });
  expect(consoleErrors).toEqual([]);
});

test("Pricing v2.1 keeps Checkout working", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  await startPricing("v2.1");

  await page.goto("/");

  await expect(page.locator('link[rel~="icon"]')).toHaveAttribute("href", /.+/);
  await expect(page.getByText("Pricing available")).toBeVisible();
  await expect(page.getByText("INR 1299")).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
  expect(consoleErrors).toEqual([]);
});
